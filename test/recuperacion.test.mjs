import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const pagina=await readFile(new URL('../src/pages/tickets/NewTicket.tsx',import.meta.url),'utf8');
const fuente=await readFile(new URL('../src/lib/db/localApiAdapter.ts',import.meta.url),'utf8');
const compilar=(texto)=>ts.transpileModule(texto,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(compilar(fuente).replace('import.meta.env.VITE_API_URL','"http://localhost:4000/api"')).toString('base64'));
const arbol=ts.createSourceFile('NewTicket.tsx',pagina,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const funcion=arbol.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='resultadoDesconocido');
assert.ok(funcion,'La prueba debe ejercitar la función real de recuperación');
const desconocido=new Function('ErrorApi',compilar(funcion.getText(arbol))+';return resultadoDesconocido;')(api.ErrorApi);
test('Conserva referencias ante errores de sesión, permisos, saturación y servidor',()=>{
 for(const status of [401,403,408,429,500,502,503])assert.equal(desconocido(new api.ErrorApi('Prueba',status)),true,`HTTP ${status}`);
});
test('Un rechazo de datos permite liberar el intento',()=>{
 for(const status of [400,404,409,422])assert.equal(desconocido(new api.ErrorApi('Prueba',status)),false,`HTTP ${status}`);
});
test('Red caída y errores inesperados conservan la referencia',()=>{
 assert.equal(desconocido(new TypeError('Red caída')),true);assert.equal(desconocido(new Error('Desconocido')),true);
});
test('Una respuesta incompleta no confirma la creación del folio',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('incompleto',{status:200}));
 await assert.rejects(api.crearTicket({}),TypeError);
});
test('El cierre de sesión propaga el error para informar al usuario',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('{"error":"No disponible"}',{status:503}));
 await assert.rejects(api.cerrarSesion(),e=>e instanceof api.ErrorApi&&e.status===503);
});
