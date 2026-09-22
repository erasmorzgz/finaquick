// Configuración para pm2 — hace que el servidor se vuelva a prender
// solo si truena (o si el servidor completo se reinicia), en vez de
// quedarse caído hasta que alguien se dé cuenta y lo prenda a mano.
//
// Uso (después de "npm run build", que genera dist/):
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save            (para que sobreviva un reinicio de la máquina)
//   pm2 startup         (una sola vez — deja instrucciones para que
//                        pm2 mismo arranque solo al prender la máquina)
//
// Ver LOCAL_SETUP.md, sección "Monitoreo y que se reinicie solo".
module.exports = {
  apps: [
    {
      name: "finaquick-api",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s", // menos que esto entre reinicios = probablemente un error real, no un tropiezo pasajero
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
