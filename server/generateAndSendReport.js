import { Connection } from 'tedious';

const config = {
  userName: 'sa',
  password: 'Password12$',
  server: 'localhost',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    database: '_Datos',
    port: 1433,
  },
};

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
