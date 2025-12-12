const express = require('express');
const mysql = require('mysql2');
const http = require('http');
const { Server } = require("socket.io");
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path'); 
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- KONFIGURASI BOT TELEGRAM ---
const token = process.env.TELEGRAM_BOT_TOKEN; 
const bot = new TelegramBot(token, {polling: true});
const chatId = process.env.TELEGRAM_CHAT_ID; 

// --- KONFIGURASI BMKG ---
// Ganti dengan kode wilayah ADM4 (Kelurahan/Desa) lokasi sensor Anda
const KODE_WILAYAH_BMKG = '31.71.03.1001'; 
const URL_BMKG = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${KODE_WILAYAH_BMKG}`;
const MIN_KEDALAMAN_BAHAYA = 300; // cm
const MIN_KEDALAMAN_WASPADA = 250; // cm

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- KONFIGURASI DATABASE ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

let statusTerakhir = 'AMAN'; 

// =================================================================================
// FUNGSI UTILITY (BMKG)
// =================================================================================

/**
 * Mengambil data prakiraan cuaca terdekat dan meringkasnya.
 * @returns {Object} Objek ringkasan cuaca atau null jika gagal.
 */
async function getPrakiraanCuaca() {
    try {
        console.log('--- Mencoba mengambil data BMKG dari URL:', URL_BMKG); 
        const response = await axios.get(URL_BMKG, { timeout: 5000 });
        console.log('--- Respons BMKG diterima. Status:', response.status);

        const prakiraanArray = response.data?.data?.[0]?.cuaca?.[0];
        
        if (!prakiraanArray || prakiraanArray.length === 0) {
            console.log('--- Gagal: Struktur data BMKG tidak sesuai atau prakiraan cuaca kosong.');
            return null;
        }

        // Data prakiraan terdekat (objek pertama dalam array)
        const cuacaTerdekat = prakiraanArray[0]; 
        
        console.log('--- Data Cuaca Ditemukan:', cuacaTerdekat.weather_desc_en);
        
        return {
            waktu_prakiraan: cuacaTerdekat.local_datetime, // Gunakan waktu lokal
            cuaca_terdekat: cuacaTerdekat.weather_desc_en,
            suhu_terdekat: cuacaTerdekat.t, 
            kelembaban_terdekat: cuacaTerdekat.hu, 
            ws_terdekat: cuacaTerdekat.ws, 
            tcc_terdekat: cuacaTerdekat.tcc, 
            // Tentukan apakah hujan (kode weather 60, 61, 63, 80, 95, 97, dll.)
            is_hujan_deras: cuacaTerdekat.weather_desc_en.includes('Rain') || cuacaTerdekat.weather_desc_en.includes('Thunder')
        };

    } catch (error) {
        console.error('Gagal mengambil data dari BMKG API:', error.message);
        return null;
    }
}

// =================================================================================
// ENDPOINT UNTUK ESP32 (POST) - LOGIKA UTAMA
// =================================================================================

app.post('/api/data', async (req, res) => {
    const { jarak, kontak_air} = req.body;
    let status = 'AMAN';
    let pesanTelegram = null;
    let kedalaman = 300 - jarak; // Konversi jarak ke kedalaman air (cm)

    // --- Langkah 1: Tentukan Status Sensor Awal ---
    if (kontak_air == 1 || kedalaman >= MIN_KEDALAMAN_BAHAYA) {
        status = 'BAHAYA';
    } else if (kedalaman > MIN_KEDALAMAN_WASPADA) {
        status = 'WASPADA';
    }

    // --- Langkah 2: Ambil Data Cuaca BMKG ---
    const dataCuaca = await getPrakiraanCuaca();
    
    // De-strukturisasi data cuaca untuk kemudahan
    const cuaca_terdekat = dataCuaca?.cuaca_terdekat || 'N/A';
    const suhu_terdekat = dataCuaca?.suhu_terdekat || null;
    const kelembaban_terdekat = dataCuaca?.kelembaban_terdekat || null;
    const ws_terdekat = dataCuaca?.ws_terdekat || null;
    const tcc_terdekat = dataCuaca?.tcc_terdekat || null;
    const waktu_prakiraan = dataCuaca?.waktu_prakiraan || null;

    // --- Langkah 3: Gabungkan Data & Simpan ke Tabel Agregasi ---
    const queryAgregasi = `INSERT INTO data_agregasi (kedalaman, sensor_kontak, status_alert, cuaca_terdekat, suhu_terdekat, kelembaban_terdekat, ws_terdekat, tcc_terdekat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(queryAgregasi, 
        [kedalaman, kontak_air, status, cuaca_terdekat, suhu_terdekat, kelembaban_terdekat, ws_terdekat, tcc_terdekat], 
        (err, result) => {
            if (err) {
                console.error('Database Agregasi Error:', err);
            }
        });

    // --- Langkah 4: Kirim ke Frontend (Socket.IO) ---
    const dataSocket = {
        // Data Sensor
        kedalaman: kedalaman,
        kontak: kontak_air,
        status: status,
        waktu: new Date().toLocaleTimeString(),
        
        // Data Cuaca (Terpisah)
        cuaca_desc: cuaca_terdekat,
        suhu: suhu_terdekat,
        kelembaban: kelembaban_terdekat,
        kecepatan_angin: ws_terdekat,
        tutupan_awan: tcc_terdekat,
        waktu_prakiraan: waktu_prakiraan,
        
        // Tambahan
        is_hujan_deras: dataCuaca?.is_hujan_deras || false // Untuk logika di frontend
    };
    io.emit('sensor_update', dataSocket); // <-- Klien menerima data 
    
    console.log(`Data Masuk: kedalaman ${kedalaman}cm | Status: ${status} | Cuaca: ${cuaca_terdekat}`);
    
    // Logika notifikasi Telegram 
    if (dataCuaca && dataCuaca.is_hujan_deras && status === 'AMAN' && statusTerakhir !== 'PERINGATAN_CUACA') {
        pesanTelegram = `🌧️ PERINGATAN DINI CUACA 🌧️\nDiprediksi ${dataCuaca.cuaca_terdekat} (Suhu: ${dataCuaca.suhu_terdekat}°C) dalam waktu dekat.\nKetinggian air saat ini ${kedalaman} cm (Masih AMAN), namun potensi banjir meningkat.`;
        statusTerakhir = 'PERINGATAN_CUACA'; 
    } 
    else if (status !== statusTerakhir) {
        statusTerakhir = status;
        const infoCuacaTambahan = dataCuaca ? `\n\nCuaca Terdekat: ${cuaca_terdekat} (Suhu: ${suhu_terdekat}°C)` : '';

        if (status === 'WASPADA') {
            pesanTelegram = `⚠️ WASPADA BANJIR! ⚠️\nKetinggian air mencapai: ${kedalaman} cm.\nHarap waspada!${infoCuacaTambahan}`;
        } else if (status === 'BAHAYA') {
            pesanTelegram = `🚨 ALERT BANJIR! 🚨\nKetinggian air mencapai: ${kedalaman} cm.\nSegera ambil tindakan darurat!${infoCuacaTambahan}`;
        } else if (status === 'AMAN') {
            pesanTelegram = `✅ Kondisi kembali AMAN.\nKetinggian air saat ini: ${kedalaman} cm. \n${infoCuacaTambahan}`;
        }
    }
    
    if (pesanTelegram) {
        bot.sendMessage(chatId, pesanTelegram).catch(console.error);
    }
    
    res.json({ message: "Data aggregated and saved", command_siren: status === 'BAHAYA' });
});

// =================================================================================
// SERVER START
// =================================================================================

server.listen(3000, () => {
    console.log('Server berjalan di port 3000');
    console.log('Pastikan ESP32 mengirim data ke: http://localhost:3000/api/data');
    console.log("halaman dashboard http://localhost:3000");
});