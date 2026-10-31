# 🚀 SMS Lead Blaster — Apne Ubuntu VPS par host karein

Ye guide aapke **Ubuntu 22.04 / 24.04** VPS ke liye hai. Ek hi script se
Python, Node, MongoDB, aur Nginx sab set ho jayega.

> ⚠️ Note: Main (AI) aapke VPS par direct SSH karke install **nahi** kar sakta —
> mere paas aapke server ka access nahi hai. Neeche diye steps aap apne VPS par
> chalayenge (copy-paste). 10 minute me ho jayega.

---

## Aapko kya chahiye
- Ek Ubuntu VPS (22.04 ya 24.04), root/sudo access
- (Optional but recommended) Ek domain (e.g. `app.example.com`) jiska DNS **A record**
  aapke VPS ke IP par point karta ho → tabhi HTTPS (https) auto lag jayega.
  Domain na ho to seedha server **IP** se bhi chalega (http).

---

## Step 1 — Code VPS par le jaayein

**Tareeka A — GitHub se (chat me "Save to GitHub" karke):**
```bash
sudo apt update && sudo apt install -y git
git clone <your-repo-url> leadblaster
cd leadblaster
```

**Tareeka B — Apne PC se scp karke:**
```bash
# apne computer se (jahan code download kiya hai)
scp -r ./leadblaster root@<VPS_IP>:/root/
# phir VPS par:
cd /root/leadblaster
```

---

## Step 2 — Ek command chalayein

Domain ke saath (HTTPS auto):
```bash
sudo bash deploy/install.sh app.example.com
```

Ya sirf IP ke saath (HTTP):
```bash
sudo bash deploy/install.sh 203.0.113.45
```

Bas! Script khatam hone par terminal me aapka URL dikh jayega.

---

## Step 3 — App kholें

- Browser me apna URL kholें (`https://app.example.com` ya `http://<IP>`).
- Pehli baar **"Create Admin"** screen aayega → apna admin username + password set karein.
- Phir admin se clients banao, client login karke apne Firebase add karke blast chalao.

---

## Firewall (agar on hai)
```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## Zaroori baatein
- **Backend 1 hi worker par chalta hai** (`--workers 1`). Ise mat badhao —
  background/scheduled blast tasks server ki memory me chalte hain, multiple
  workers se progress/stop toot jayega.
- **MongoDB** usi VPS par local chalta hai (`mongodb://localhost:27017`).
  Chaho to MongoDB Atlas (cloud) use kar sakte ho — `backend/.env` me `MONGO_URL`
  badal do aur `sudo systemctl restart leadblast`.
- **Scheduled blasts** tabhi chalenge jab server on ho (backend service chalti rahe).

## Updates lagane ke liye (naya code aaya to)
```bash
cd /root/leadblaster
git pull                      # ya naya code copy karo
cd backend && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ..
cd frontend && yarn install && yarn build && cd ..
sudo systemctl restart leadblast
sudo systemctl restart nginx
```

## Troubleshooting
```bash
systemctl status leadblast      # backend chal raha hai?
journalctl -u leadblast -f      # live backend logs/errors
systemctl status mongod         # database chal raha hai?
nginx -t && systemctl status nginx
```
- Blank page / 502? → `journalctl -u leadblast -f` me error dekho.
- API call fail? → `backend/.env` me `CORS_ORIGINS` aapke URL se match karni chahiye,
  aur `frontend/.env` me `REACT_APP_BACKEND_URL` bhi wahi URL ho (phir `yarn build` dobara).
