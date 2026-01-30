# Guard Report Server - Deployment Package
Version: 3.0.0
Build Date: 2026-01-28

## 🚀 QUICK START (3 Easy Steps!)

### Step 1: Configure
1. Open ".env" file in Notepad
2. Set your database details:
   - DB_SERVER=your_server_ip
   - DB_USER=your_username  
   - DB_PASSWORD=your_password

### Step 2: Run
- Double-click "guard-report-server.exe"
- Browser will open automatically!

### Step 3: Access
- Local: http://localhost:5000
- Network: http://YOUR_COMPUTER_IP:5000

## 💡 That's it! You're done!

---

## 📋 DETAILED SETUP GUIDE

### Network Access (Access from other computers)

If you want to access from other computers on your network:

1. Find your computer's IP address:
   - Open Command Prompt (Win+R, type "cmd")
   - Type: ipconfig
   - Look for "IPv4 Address" (e.g., 192.168.1.100)

2. Configure Windows Firewall:
   - Open "Windows Defender Firewall with Advanced Security"
   - Click "Inbound Rules" → "New Rule"
   - Select "Port" → Next
   - Enter "5000" → Next
   - Select "Allow the connection" → Next
   - Check all profiles → Next
   - Name it "Guard Report Server" → Finish

3. Access from network:
   - From another computer: http://192.168.1.100:5000
   - Replace 192.168.1.100 with your actual IP

### Configuration Options (.env file)

Key settings you can modify:

```
# Server Port (change if 5000 is in use)
PORT=5000

# Auto-open browser when starting (true/false)
AUTO_OPEN_BROWSER=true

# Database Connection
DB_SERVER=192.168.0.55
DB_USER=sa
DB_PASSWORD=your_password
DB_DATABASE=_Datos

# Email Settings (optional)
ENABLE_EMAIL_SENDING=true
EMAIL_USER=alerts@yourdomain.com
EMAIL_PASS=your_email_password
```

## 🔧 TROUBLESHOOTING

### "Port 5000 is already in use"
**Solution:** Change PORT in .env file to 5001, 5002, etc.

### Can't access from network
**Solutions:**
1. Check HOST=0.0.0.0 in .env (not localhost)
2. Configure Windows Firewall (see above)
3. Verify both computers are on same network
4. Disable antivirus temporarily to test

### Database connection fails
**Solutions:**
1. Verify database server is running
2. Check DB_SERVER, DB_USER, DB_PASSWORD in .env
3. Ensure SQL Server allows remote connections
4. Test connection with SQL Server Management Studio

### Email sending fails
**Solutions:**
1. Verify EMAIL_USER and EMAIL_PASS in .env
2. Check if email provider requires "App Passwords"
3. Verify SMTP settings for your email provider

### Application won't start
**Solutions:**
1. Check if port 5000 is available
2. Run from Command Prompt to see errors
3. Check .env file for syntax errors
4. Verify Node.js 18+ was used to build

## 📊 MONITORING

### Check if server is running:
1. Open browser to: http://localhost:5000/api/health
2. Should see JSON response with "success: true"

### View logs:
- Check files in same folder as .exe
- Look for: scheduler_errors.log, scheduler_success.log

### Stop the server:
- Open Task Manager (Ctrl+Shift+Esc)
- Find "guard-report-server.exe"
- Click "End Task"

## 🔄 UPDATING

To update to a new version:
1. Stop current server (Task Manager → End Task)
2. Replace guard-report-server.exe with new version
3. Update .env if needed
4. Start server again

## 📞 SUPPORT

For help contact:
- Email: it-support@bmsecurity.com
- Phone: [Your support number]

## 🎉 Release Notes

Version 3.0.0 - 2026-01-28

Features:
- ✅ Windows GUI application (no console window)
- ✅ Embedded web interface
- ✅ Auto-opens browser on start
- ✅ Network access ready
- ✅ Automatic scheduler
- ✅ Email report delivery
- ✅ Production-ready

---

Built with ❤️ for BM Security
