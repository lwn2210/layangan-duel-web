# layangan-duel-web — Status: PROTOTIPE (milestone 1)

## Apa ini
Adu layangan 3D di browser. TypeScript + Vite 8 + Three.js. Tiga mode: lawan PC (Mudah / Sedang / Jago), **Duel Teman** (kode room 5 huruf atau link `?room=KODE`), dan **Lawan Acak** (antrean matchmaking, kalau 20 detik nggak ada lawan ditawarin main lawan PC).

## Arsitektur (siap online)
- `src/sim/`: seluruh match berupa data JSON biasa + satu fungsi `step(state, [input0, input1])` dengan tick tetap 60 Hz. Tanpa DOM, jam, atau `Math.random`, jadi seed dan input yang sama selalu menghasilkan match yang sama (ada tesnya).
- `src/bot/`: bot cuma menghasilkan `Input`, sama persis kayak pemain. Sim nggak bisa bedain bot sama orang.
- `src/render/`: Three.js cuma membaca state.
- Geometri layar: kamera tetap di `layout.ts`. Tangan pemain diproyeksikan ke bidang layangan dari posisi kamera, jadi benang nyilang di sim = nyilang di layar, berapa pun FOV-nya. Posisi kamera itu bagian dari aturan main, jangan diubah per device.

## Online
- Server authoritative: room menjalankan `step()` yang sama di server pada 60 Hz, client cuma kirim `Input` (saat berubah + tiap 250 ms) dan menggambar snapshot (30/detik, diinterpolasi). Protokol di `src/net/protocol.ts`.
- `server/room.ts` + `server/lobby.ts`: logika room dan matchmaking, tanpa socket. Dipakai dua adapter:
  - `server/node.ts`: nempel di dev/preview server Vite, jadi `npm run dev` sudah lengkap dengan multiplayer. `npm run serve` = Node standalone (dist + socket di satu port) buat VPS/Render/Fly.
  - `server/worker.ts` + `wrangler.toml`: Cloudflare Worker yang nyajiin `dist/` + Durable Object per room dan satu lobby global. `npm run cf:dev` (lokal), `npm run cf:deploy` (butuh `wrangler login`). Wrangler 4.151 butuh **Node 22+**; mesin ini default Node 20, Node 24 ada di nvm.
- Pemain slot 1 melihat lapangan dicerminkan (`src/net/mirror.ts`), jadi semua orang main dari kiri dengan layangan merah. Simetris, jadi silang benang tetap persis.
- Pemain ketiga ditolak ("Room penuh"), versi protokol beda ditolak, lawan keluar dikabari, main lagi butuh dua-duanya setuju.

## Mekanik
- Tahan = tarik (layangan melesat ke arah hidung, sisa benang ulur ditarik balik). Lepas = ulur (muter pelan, turun, benang keluar). A/D = belok.
- Benang nyilang = gesek. Kerusakan per detik = `SAW·(1 + kecepatan benang lawan) / (1 + 0,5·kecepatan benangmu)`. Benang yang diam putus duluan.
- Jatuh di bawah 3 m = nyangkut genteng, kalah ronde. Ronde maks 90 detik, menang 3 ronde = juara.
- Bot naikin layangan dulu 5 detik di awal ronde sebelum nyerang.
- Suara sintetis Web Audio (tanpa file): angin, kepak saat tarik, klik gulungan saat ulur (makin cepat makin rapat), desis gesek, "tas!" + siulan saat putus, beep hitung mundur. Tombol 🔊 atau M buat mute.

## Tes
- `npm run verify`: 27 tes vitest (13 sim: geometri, proyeksi, terbang, determinisme, gesek/putus, alur match, bot; 14 online) + typecheck (browser + worker) + build. Lulus 2026-11-03.
- Simulasi 20 match bot vs bot (setelah tuning 2026-11-03, `SAW` 6 → 2,4 + warm-up bot): ronde rata-rata ±25 detik (sebelumnya 8,5), gesek ±18 detik per ronde. Sedang vs Sedang 49:39, Jago vs Mudah 60:0.
- Safari iOS (iPhone 17 simulator, 2026-11-03): render, tombol sentuh (tahan Tarik), gesek, dan AudioContext jalan.
- Dicek di browser pane: menu (latarnya demo bot vs bot), countdown, gesek + percikan pas di titik silang, pergantian ronde, layout HP dengan tombol sentuh. Tanpa error console.
- Online (2026-11-03): 14 tes jaringan di vitest (room, lobby, protokol, mirror, hasil sim server = sim lokal). Dua client WebSocket beneran ke dev server Node **dan** ke `wrangler dev` (Durable Object lokal): ±30 snapshot/detik, tick sama di dua client, input sampai, pemain ketiga ditolak, keluar dikabari, matchmaking memasangkan. Di browser: dua tab via link undangan dan via Cari lawan, mirror slot 1 benar (narik = layangan kiri naik di layarnya, layangan kanan naik di layar lawan), "Lawan keluar" tampil.

## Berikutnya
1. Deploy ke Cloudflare (akun kamu) dan playtest online beneran antar HP
2. Prediksi lokal buat layangan sendiri kalau ping tinggi terasa lambat (sekarang input → layar = 1 RTT + ±33 ms)
3. Reconnect kalau koneksi putus sebentar (sekarang langsung dianggap keluar)
4. Layangan putus dikejar anak-anak, skin layangan/gelasan

## Gap
- `Math.sin/exp` bisa beda tipis antar engine JS; makanya online pakai server-authoritative, bukan lockstep antar browser
- Belum dites lewat internet beneran (cuma localhost), belum ada rate limit / anti-spam room
- Lobby matchmaking satu Durable Object global, cukup buat prototipe
- Belum dites di iPhone fisik dan Safari macOS. Di iPhone, saklar silent ikut membisukan Web Audio
- Di HP portrait FOV melebar (sampai 100°), jadi layangan kelihatan kecil. Lebih enak landscape
