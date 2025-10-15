Thai Gala - Mobile-first demo

Quick steps to run locally and test on phones:

1. Open a terminal (PowerShell) and change to the folder:

   cd "C:\Users\alexa\Desktop\thai_gala_mobile_site"

2. Start a simple static server. If you have Python 3 installed:

   python -m http.server 8000

   or (PowerShell) for Python 3 installed as 'py':

   py -3 -m http.server 8000

   If you don't have Python, Node.js users can:

   npx http-server -c-1 . 8000

3. Find your PC's local IP address (PowerShell):

   ipconfig | Select-String "IPv4" -Context 0,0

   Use the IPv4 address shown, e.g. 192.168.1.42

4. On your phone (connected to same Wi-Fi), open: http://<your-ip>:8000

5. Optional: use ngrok to expose your local server for remote testing:

   ngrok http 8000

That's it.

Java option (no Python/Node required)
- If you have Java 11+ installed, you can run the bundled SimpleFileServer (or use any static server).

Compile and run:

```powershell
cd "C:\Users\alexa\Desktop\thai_gala_mobile_site"
javac SimpleFileServer.java
java SimpleFileServer 8000 .
```

Then open http://<your-ip>:8000 on your phone.

QR code usage
- Open the page in your desktop browser and click "Show QR". Scan that QR from your phone to open the same URL.

Admin quick control
- On the page tap the "Admin" button to set which match is live (enter the match index 1..N).

Files added/changed
- `index.html` — fight-card layout and QR modal
- `styles.css` — styles for fight card and modal
- `fightcard.js` — client-side controller for fight list and QR generation
- `SimpleFileServer.java` — simple Java static file server (optional)

If you'd like, I can:
- Add a small admin-only page with a PIN
- Store live match selection in localStorage so it persists on refresh
- Add a printer-friendly view

Tell me which of those you'd like next.