// Escribe el SQL que crea la organización y la invitación del primer
// administrador — lo usan los dos instaladores ("Iniciar Finaquick.bat"
// y ".command"). Existe porque pasar el nombre directo a psql con -v
// dependía de la codificación de la consola: en Windows un nombre con
// acento ("Anáhuac") llegaba mal, las dos inserciones fallaban y la
// instalación decía "Listo" sin haber creado ninguna invitación. Node
// recibe los argumentos en Unicode en cualquier sistema, así que el
// archivo sale siempre en UTF-8 y psql lo lee declarado como tal
// (PGCLIENTENCODING=UTF8 en quien lo llama).
//
// Uso: node scripts/sql-invitacion-inicial.js <institucion> <correo> <codigo> <archivo-salida>
import { writeFileSync } from "node:fs";

const [institucion, correo, codigo, salida] = process.argv.slice(2);
if (!institucion?.trim() || !correo?.trim() || !codigo || !salida) {
  console.error("Uso: node scripts/sql-invitacion-inicial.js <institucion> <correo> <codigo> <archivo-salida>");
  process.exit(1);
}

const literal = (valor) => `'${String(valor).trim().replace(/'/g, "''")}'`;

writeFileSync(
  salida,
  `with org as (
  insert into organizations (nombre, color_primario) values (${literal(institucion)}, '#3a3a3a') returning id
)
insert into invitaciones (correo, org_id, rol, token)
select ${literal(correo)}, id, 'admin', ${literal(codigo)} from org;
`,
  "utf8"
);
