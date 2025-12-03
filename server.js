const express = require('express');
const mysql = require('mysql2');
const http = require('http');
const { Server } = require("socket.io");
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path'); 
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const token = '8180656299:AAFtS7ZEce8k5ZSHmkJSQJD26PvF1haF75k';
const bot = new TelegramBot(token, {polling: true});
const chatId = '-1003257620291';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

let statusTerakhir = 'AMAN'; 

app.post('/api/data', (req, res) => {
    const { kedalaman, kontak_air } = req.body;

    let status = 'AMAN';
    if (kontak_air == 1 || kedalaman >= 300) {
        status = 'BAHAYA';
    } else if (kedalaman > 250) {
        status = 'WASPADA';
    }

    const query = 'INSERT INTO sensor_logs (kedalaman, sensor_kontak, status_alert) VALUES (?, ?, ?)';
    db.query(query, [kedalaman, kontak_air, status], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database Error');
        }

        io.emit('sensor_update', {
            kedalaman: kedalaman,
            kontak: kontak_air,
            status: status,
            waktu: new Date().toLocaleTimeString()
        });

        console.log(`Data Masuk: kedalaman ${kedalaman}cm | Kontak: ${kontak_air} | Status: ${status}`);

        res.json({ message: "Data saved", command_siren: status === 'BAHAYA' });
    });
   
    if (status !== statusTerakhir) {
        statusTerakhir = status;

        let pesan;
        if (status === 'WASPADA') {
            pesan = `⚠️ WASPADA BANJIR! ⚠️\nKetinggian air mencapai: ${kedalaman} cm.\nHarap waspada!`;
        } else if (status === 'BAHAYA') {
            pesan = `🚨 ALERT BANJIR! 🚨\nKetinggian air mencapai: ${kedalaman} cm.\nSegera ambil tindakan darurat!`;
        } else if (status === 'AMAN') {
            pesan = `✅ Kondisi kembali AMAN.\nKetinggian air saat ini: ${kedalaman} cm.`;
        }

        if (pesan) {
            bot.sendMessage(chatId, pesan).catch(console.error);
        }
    }
});

server.listen(3000, () => {
    console.log('Server berjalan di port 3000');
    console.log('ESP32 mengirim data ke: http://localhost:3000/api/data');
    console.log("halaman dashboard (front-end) http://localhost:3000")
});