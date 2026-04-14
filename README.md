# BPLog — Blood Pressure Log

A frictionless, self-hosted Progressive Web App (PWA) for tracking blood pressure readings from photos. All processing — OCR, storage, charting, and PDF generation — happens **on your device**. No data is ever sent to an external server.

---

## Problem Statement

Tracking blood pressure should be as simple as taking a photo. Existing solutions often require manual entry, expensive hardware, or surrendering your health data to a cloud service. BPLog solves this by offering a **frictionless, device-agnostic, privacy-first logging experience** that you fully own and control.

---

## Core Principles

| Principle | What it means for you |
|-----------|-----------------------|
| **Self-hosted** | The app is a static bundle you can host anywhere. The "server" is your phone or browser. |
| **Device-agnostic** | Works on any modern smartphone, tablet, or desktop browser. |
| **Data ownership** | Your images, logs, and reports live in your browser's IndexedDB. You own everything. |
| **No tracking** | No analytics, no cookies, no telemetry. Zero external data transmission. |
| **Data portable** | One-click export to JSON or ZIP. One-click import on any other device. |
| **Open source** | Licensed under GPL-3.0. Anyone can inspect, modify, and improve the code. |

---

## Quick Start

1. Open the app in your browser.
2. Tap **"Add to Home Screen"** (or **Install**) from your browser menu.
3. Create a user profile.
4. Take or upload a photo of your BP monitor.
5. Review the OCR results, edit if needed, and save.

> **Note:** This site will not save your settings — only your device will. All data stays local.

---

## Tech Stack

- **OCR:** Tesseract.js v5 (WebAssembly, on-device)
- **Charts:** Chart.js
- **PDF:** jsPDF + jsPDF-AutoTable
- **Storage:** IndexedDB (`idb` wrapper)
- **Archive:** JSZip
- **EXIF:** exifr
- **Styling:** Vanilla CSS (mobile-first, dark mode supported)

---

## Credits

Originally made by [**Comfac-IT.com**](https://comfac-it.com) with assistance from **Kimi**, **Claude**, and **DeepSeek**.

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.  
You are free to use, modify, and distribute it, provided that derivative works remain open source under the same license.

---

## Disclaimer

**This is not a medical app.** BPLog is a personal logging tool. It does not provide diagnosis, medical advice, or clinical decision support. Always consult a qualified healthcare professional for medical concerns.
