const { Connection } = require('tedious');

const config = {
  userName: 'sa',
  password: 'Password12',
  server: 'localhost',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    database: '_Datos',
    port: 1433,
  },
};

const clients = [
  { name: 'ALARI CONFIGURACION 1', email: 'alari1@company.com' },
  { name: 'ALARI CONFIGURACION 2', email: 'alari2@company.com' },
  { name: 'ALARI CONFIGURACION 3', email: 'alari3@company.com' },
  { name: 'BM HQ', email: 'bmhq@company.com' },
  { name: 'BM POLO VIGICONTROL', email: 'bmpolo@company.com' },
  { name: 'BM SECURITY - POLO', email: 'bmsecuritypolo@company.com' },
  { name: 'BM SECURITY ELDORET', email: 'bmeldoret@company.com' },
  { name: 'BM SECURITY HQ', email: 'bmsecurityhq@company.com' },
  { name: 'BM SECURITY KISUMU', email: 'bmkisumu@company.com' },
  { name: 'BM SECURITY MOMBASA', email: 'bmmombasa@company.com' },
  { name: 'BM SECURITY NAKURU', email: 'bmnakuru@company.com' },
  { name: 'BM SECURITY NYERI', email: 'bmnyeri@company.com' },
  { name: 'BM SMARTPANICS', email: 'bmsmartpanics@company.com' },
  { name: 'BM TECGUARD TEST', email: 'bmtecguard@company.com' },
  { name: 'CUENTA RESERVADA PARA EVENTOS INTERNOS', email: 'cuentaeventos@company.com' },
  { name: 'CWS NICOLE RESIDENCE', email: 'cwsnicole@company.com' },
  { name: 'CWS SCOTT RESIDENCE', email: 'cwsscott@company.com' },
  { name: 'ELITE RESIDENCE VAAL', email: 'elitevaal@company.com' },
  { name: 'HIGHCHEM LTD', email: 'highchem@company.com' },
  { name: 'MULTICHOICE BOMET', email: 'bomet@multichoice.com' },
  { name: 'MULTICHOICE BUSIA', email: 'busia@multichoice.com' },
  { name: 'MULTICHOICE EMBU', email: 'embu@multichoice.com' },
  { name: 'MULTICHOICE HOMABAY', email: 'homabay@multichoice.com' },
  { name: 'MULTICHOICE KAPENGURIA', email: 'kapenguria@multichoice.com' },
  { name: 'MULTICHOICE KERICHO', email: 'kericho@multichoice.com' },
  { name: 'MULTICHOICE KIBOSWA', email: 'kiboswa@multichoice.com' },
  { name: 'MULTICHOICE LUKUME', email: 'lukume@multichoice.com' },
  { name: 'MULTICHOICE MENENGAI CRATER', email: 'menengai@multichoice.com' },
  { name: 'MULTICHOICE MIGORI', email: 'migori@multichoice.com' },
  { name: 'MULTICHOICE MUA HILLS', email: 'muahills@multichoice.com' },
  { name: 'MULTICHOICE MURANGA', email: 'muranga@multichoice.com' },
  { name: 'MULTICHOICE MUTONYI HILLS', email: 'mutonyi@multichoice.com' },
  { name: 'MULTICHOICE VIEWPOINT', email: 'viewpoint@multichoice.com' },
  { name: 'NBST NGARA', email: 'ngara@company.com' },
  { name: 'PRUEBA', email: 'prueba@company.com' },
  { name: 'ROMEO 10', email: 'romeo10@company.com' },
  { name: 'ROMEO 12', email: 'romeo12@company.com' },
  { name: 'ROMEO 14', email: 'romeo14@company.com' },
  { name: 'ROMEO 16', email: 'romeo16@company.com' },
  { name: 'ROMEO 18', email: 'romeo18@company.com' },
  { name: 'ROMEO 2', email: 'romeo2@company.com' },
  { name: 'ROMEO 20', email: 'romeo20@company.com' },
  { name: 'ROMEO 24', email: 'romeo24@company.com' },
  { name: 'ROMEO 28', email: 'romeo28@company.com' },
  { name: 'ROMEO 30', email: 'romeo30@company.com' },
  { name: 'ROMEO 32', email: 'romeo32@company.com' },
  { name: 'ROMEO 34', email: 'romeo34@company.com' },
  { name: 'ROMEO 4', email: 'romeo4@company.com' },
  { name: 'ROMEO 6', email: 'romeo6@company.com' },
  { name: 'ROMEO 8', email: 'romeo8@company.com' },
  { name: 'ROMEO VEHICLES', email: 'romeovehicles@company.com' },
  { name: 'SANDALWOOD BROOKSIDE LTD', email: 'sandalwood@company.com' },
  { name: 'SARIT CENTRE', email: 'sarit@company.com' },
  { name: 'SMART PANIC', email: 'smartpanic@company.com' },
  { name: 'TECGUARD TEST ACCOUNT', email: 'tecguardtest@company.com' },
  { name: 'TECGUARD TEST0000', email: 'tecguard0000@company.com' },
  { name: 'TEST', email: 'test@company.com' },
  { name: 'TEST12', email: 'test12@company.com' }
];

const connection = new Connection(config);

connection.on('connect', (err) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Connected to the database!');
  }
  connection.close();
});

connection.connect();