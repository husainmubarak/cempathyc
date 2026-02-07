// Ganti URL ini dengan alamat IP/Domain server Node.js Anda
const socket = io(); 

// --- TAMBAHAN: FUNGSI AMBIL DATA AWAL ---
async function fetchLatestData() {
    try {
        const response = await fetch('/api/data/latest');
        if (!response.ok) throw new Error('Gagal mengambil data awal');
        
        const data = await response.json();
        console.log("Data awal dimuat:", data);
        updateUI(data); // Panggil fungsi yang sudah ada untuk mengisi UI
    } catch (error) {
        console.error("Error fetching latest data:", error);
        document.getElementById('status-text').innerText = "DATA KOSONG";
    }
}

// Jalankan fungsi ini saat script pertama kali dieksekusi
fetchLatestData();

// Fungsi Utama Update UI
function updateUI(data) {
    // 1. Update Angka & Teks Dasar
    document.getElementById('water-value').innerText = Number(data.kedalaman);
    document.getElementById('temp').innerText = Number(data.suhu);
    document.getElementById('humi').innerText = Number(data.kelembaban);
    document.getElementById('wind').innerText = Number(data.kecepatan_angin);
    document.getElementById('cuaca').innerText = data.cuaca_desc;
    document.getElementById('waktu-update').innerText = data.waktu;

    // 2. Logika Sensor Kontak (Water Level Sensor)
    const kontakEl = document.getElementById('kontak-status');
    if (data.kontak === 1) {
        kontakEl.innerText = "TERKENA AIR";
        kontakEl.className = "terkena-air";
    } else {
        kontakEl.innerText = "KERING";
        kontakEl.className = "kering";
    }

    // 3. Update Status Box (Aman/Waspada/Bahaya)
    const statusBoxEl = document.getElementById('status-box');
    const statusTextEl = document.getElementById('status-text');
    const waveEl = document.getElementById('wave-bg');
    
    statusTextEl.innerText = data.status;
    
    // Reset classes
    statusBoxEl.className = "status-box";
    waveEl.className = "wave";

    // Set Warna berdasarkan status dari Backend
    const s = data.status.toLowerCase();
    if (s.includes("aman")) {
        statusBoxEl.classList.add("status-aman");
        waveEl.classList.add("aman");
    } else if (s.includes("waspada")) {
        statusBoxEl.classList.add("status-waspada");
        waveEl.classList.add("waspada");
    } else if (s.includes("bahaya")) {
        statusBoxEl.classList.add("status-bahaya");
        waveEl.classList.add("bahaya");
    }

    // 4. Update Tinggi Animasi Air (Max 300cm)
    let heightPercent = (data.kedalaman / 300) * 100;
    waveEl.style.height = (heightPercent > 100 ? 100 : heightPercent) + "%";
}

// Mendengarkan event dari Backend (Misal event bernama 'sensorUpdate')
socket.on('sensor_update', (data) => {
    console.log("Data diterima:", data);
    updateUI(data);
});

// Menangani error koneksi
socket.on('connect_error', () => {
    console.error("Gagal terhubung ke server backend!");
    document.getElementById('status-text').innerText = "OFFLINE";
});