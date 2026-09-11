import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MAX_CODE_LENGTH = 12_000;
const MAX_INPUT_LENGTH = 20_000;
const MAX_OUTPUT_LENGTH = 24_000;
const MAX_CONCURRENT_EXECUTIONS = 2;
const ACTIVE_KEY = Symbol.for('synapse.active-python-executions');
type GlobalWithPythonCounter = typeof globalThis & { [ACTIVE_KEY]?: number };

const PYTHON_WRAPPER = String.raw`
import ast
import io
import json
from contextlib import redirect_stdout

ALLOWED_MODULES = {
    "collections", "csv", "datetime", "decimal", "fractions", "functools",
    "itertools", "json", "math", "re", "statistics", "string", "time"
}

tree = ast.parse(SYNAPSE_USER_CODE, filename="usuario.py", mode="exec")
for node in ast.walk(tree):
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        names = [alias.name.split(".")[0] for alias in node.names] if isinstance(node, ast.Import) else [(node.module or "").split(".")[0]]
        if any(name not in ALLOWED_MODULES for name in names):
            raise PermissionError("El módulo solicitado no está permitido en el sandbox.")
    if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
        raise PermissionError("El acceso a atributos internos no está permitido.")
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"eval", "exec", "compile", "open", "input", "__import__", "breakpoint", "help", "globals", "locals", "vars", "getattr", "setattr", "delattr"}:
        raise PermissionError(f"La función {node.func.id} no está permitida en el sandbox.")

real_import = __import__
def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name.split(".")[0] not in ALLOWED_MODULES:
        raise PermissionError("El módulo solicitado no está permitido en el sandbox.")
    return real_import(name, globals, locals, fromlist, level)

safe_builtins = {
    "__import__": safe_import,
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
    "enumerate": enumerate, "Exception": Exception, "filter": filter,
    "float": float, "int": int, "len": len, "list": list, "map": map,
    "max": max, "min": min, "object": object, "print": print, "range": range,
    "reversed": reversed, "round": round, "set": set, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple, "TypeError": TypeError,
    "ValueError": ValueError, "zip": zip,
}
namespace = {"__builtins__": safe_builtins, "__name__": "synapse_user_code"}
stdout = io.StringIO()
with redirect_stdout(stdout):
    exec(compile(tree, "usuario.py", "exec"), namespace, namespace)
    main = namespace.get("main")
    if not callable(main):
        raise ValueError("El código debe definir una función main(input).")
    result = main(json.loads(SYNAPSE_INPUT_JSON))

json.dumps({"result": result, "stdout": stdout.getvalue()[-8000:]}, ensure_ascii=False, default=str)
`;

const WORKER_SOURCE = `
(async () => {
  let parentPort;
  try {
    const workerThreads = await import('node:worker_threads');
    parentPort = workerThreads.parentPort;
    if (!parentPort) throw new Error('El canal del worker no está disponible.');
    const pyodideModule = await import(workerThreads.workerData.pyodideModuleUrl);
    const loadPyodide = pyodideModule.loadPyodide || pyodideModule.default?.loadPyodide;
    if (typeof loadPyodide !== 'function') throw new Error('El runtime de Python no expone loadPyodide.');
    const pyodide = await loadPyodide();

    // Pyodide only needs Node internals while booting. Hide host bridges before
    // any user code is compiled so Python cannot reach the VPS or the network.
    for (const key of ['process', 'fetch', 'WebSocket', 'BroadcastChannel', 'MessageChannel', 'MessagePort']) {
      try { Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false }); } catch {}
    }

    parentPort.once('message', async ({ code, inputJson }) => {
      try {
        pyodide.globals.set('SYNAPSE_USER_CODE', code);
        pyodide.globals.set('SYNAPSE_INPUT_JSON', inputJson);
        const output = await pyodide.runPythonAsync(${JSON.stringify(PYTHON_WRAPPER)});
        parentPort.postMessage({ ok: true, value: JSON.parse(output) });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: String(error?.message || error).slice(0, 700) });
      }
    });
  } catch (error) {
    const message = 'No se pudo iniciar el sandbox de Python: ' + String(error?.message || error).slice(0, 400);
    if (parentPort) parentPort.postMessage({ ok: false, error: message });
    else throw new Error(message);
  }
})();
`;

// Resolve from the running release rather than import.meta.url. The production
// bundler preserves the source filename in that URL, which points to the build
// machine and is not valid once the artifact is deployed to the VPS.
const requireFromRelease = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const pyodideModuleUrl = pathToFileURL(requireFromRelease.resolve('pyodide')).href;

function counterScope() {
  return globalThis as GlobalWithPythonCounter;
}

export async function executePython(code: string, input: unknown, requestedTimeoutMs = 8_000) {
  const cleanCode = code.trim();
  if (!cleanCode || cleanCode.length > MAX_CODE_LENGTH) throw new Error(`El código Python debe contener entre 1 y ${MAX_CODE_LENGTH.toLocaleString('es-CL')} caracteres.`);
  const inputJson = JSON.stringify(input ?? {});
  if (inputJson.length > MAX_INPUT_LENGTH) throw new Error('La entrada de Python supera el máximo de 20 KB.');

  const scope = counterScope();
  scope[ACTIVE_KEY] ??= 0;
  if (scope[ACTIVE_KEY]! >= MAX_CONCURRENT_EXECUTIONS) throw new Error('Python está ocupado. Inténtalo nuevamente en unos segundos.');
  scope[ACTIVE_KEY]! += 1;

  const timeoutMs = Math.min(15_000, Math.max(2_000, Math.round(requestedTimeoutMs)));
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pyodideModuleUrl },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 },
  });

  try {
    return await new Promise<{ result: unknown; stdout: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error(`Python superó el límite de ${Math.round(timeoutMs / 1_000)} segundos.`));
      }, timeoutMs);
      worker.once('message', (message: { ok?: boolean; value?: { result?: unknown; stdout?: unknown }; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (!message.ok) {
          reject(new Error(message.error || 'Python no pudo ejecutar el código.'));
          return;
        }
        const value = { result: message.value?.result ?? null, stdout: typeof message.value?.stdout === 'string' ? message.value.stdout : '' };
        if (JSON.stringify(value).length > MAX_OUTPUT_LENGTH) {
          reject(new Error('La salida de Python supera el máximo de 24 KB.'));
          return;
        }
        resolve(value);
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error(`El sandbox de Python falló: ${error.message.slice(0, 400)}`));
      });
      worker.postMessage({ code: cleanCode, inputJson });
    });
  } finally {
    scope[ACTIVE_KEY] = Math.max(0, (scope[ACTIVE_KEY] ?? 1) - 1);
  }
}

export const pythonLimits = { maxCodeLength: MAX_CODE_LENGTH, maxInputLength: MAX_INPUT_LENGTH, maxOutputLength: MAX_OUTPUT_LENGTH };
