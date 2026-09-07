import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, get, set, push, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyB-JEhVSR4AqEdCphA7tjyWYfzA-4-Z_zI",
    authDomain: "ajs-hostel-billing.firebaseapp.com",
    databaseURL: "https://ajs-hostel-billing-default-rtdb.firebaseio.com",
    projectId: "ajs-hostel-billing",
    storageBucket: "ajs-hostel-billing.firebasestorage.app",
    messagingSenderId: "275424838683",
    appId: "1:275424838683:web:f396b4765adce21e35e4be"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// GLOBAL STATE
// ==========================================
let residentsData = {};
let paymentsData = {};
let roomsData = {};
let complaintsData = {};
let noticesData = {};
let currentResidentId = null;

const MONTH_OPTIONS = buildMonthOptions();

function buildMonthOptions() {
    // Generates a rolling list of months: 3 back, current, 2 ahead
    const months = [];
    const now = new Date();
    for (let i = 2; i >= -3; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    }
    return months.reverse();
}

// ==========================================
// SHARED: MODALS & ROLE NAVIGATION (defined first so nav always works,
// even if something below fails to load)
// ==========================================
window.closeModal = function (modalId) {
    document.getElementById(modalId).classList.add('hidden');
};

window.showRoleSelect = function () {
    document.getElementById('adm-login-screen').classList.add('hidden');
    document.getElementById('rp-login-screen').classList.add('hidden');
    document.getElementById('adm-app-dashboard').classList.add('hidden');
    document.getElementById('rp-app-dashboard').classList.add('hidden');
    document.getElementById('role-select-screen').classList.remove('hidden');
};

window.showLoginScreen = function (role) {
    document.getElementById('role-select-screen').classList.add('hidden');
    if (role === 'admin') {
        document.getElementById('adm-login-screen').classList.remove('hidden');
    } else {
        document.getElementById('rp-login-screen').classList.remove('hidden');
    }
};

window.logout = function () {
    localStorage.removeItem('ajs_session_role');
    localStorage.removeItem('ajs_session_resident_id');
    currentResidentId = null;
    showRoleSelect();
};

try {
    flatpickr("#adm-pay-date", { dateFormat: "Y-m-d", defaultDate: "today" });
    flatpickr("#adm-filter-month", {
        altInput: true, altFormat: "F Y", defaultDate: "today",
        onChange: function () { renderDashboard(); }
    });
} catch (error) {
    console.error("Date picker failed to load (non-critical):", error);
}

// ==========================================
// TAB NAVIGATION
// ==========================================
window.adminSwitchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

    document.getElementById('adm-fab-payment').style.display = (tabId === 'adm-tab-home') ? 'block' : 'none';

    if (tabId === 'adm-tab-rooms') renderRooms();
    if (tabId === 'adm-tab-complaints') adminRenderComplaints();
    if (tabId === 'adm-tab-notices') adminRenderNotices();
};

// ==========================================
// ADMIN AUTHENTICATION & FORGOT PASSWORD LOGIC
// ==========================================
let adminPassword = 'Admin123';

document.getElementById('adm-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('adm-login-username').value.trim();
    const pass = document.getElementById('adm-login-password').value.trim();

    if (user === 'Admin' && pass === adminPassword) {
        localStorage.setItem('ajs_session_role', 'admin');
        document.getElementById('adm-login-screen').classList.add('hidden');
        document.getElementById('adm-app-dashboard').classList.remove('hidden');
    } else {
        alert('Invalid credentials! Default: Admin / Admin123');
    }
});

window.toggleForgotPassword = function (show) {
    if (show) {
        document.getElementById('adm-login-form').classList.add('hidden');
        document.getElementById('adm-forgot-form').classList.remove('hidden');
        document.getElementById('adm-forgot-step1').classList.remove('hidden');
        document.getElementById('adm-forgot-step2').classList.add('hidden');
    } else {
        document.getElementById('adm-forgot-form').classList.add('hidden');
        document.getElementById('adm-login-form').classList.remove('hidden');
        document.getElementById('adm-forgot-step1').classList.remove('hidden');
        document.getElementById('adm-forgot-step2').classList.add('hidden');
        document.getElementById('adm-forgot-otp').value = '';
        document.getElementById('adm-forgot-newpassword').value = '';
    }
};

window.sendResetCode = function () {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    localStorage.setItem('ajs_reset_otp', otp);
    localStorage.setItem('ajs_reset_otp_expiry', String(expiry));

    const btn = document.getElementById('adm-btn-send-code');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    emailjs.send('service_htvrcng', 'template_f0tmvtc', { passcode: otp })
        .then(() => {
            document.getElementById('adm-forgot-step1').classList.add('hidden');
            document.getElementById('adm-forgot-step2').classList.remove('hidden');
        })
        .catch((error) => {
            console.error('Failed to send reset code:', error);
            alert('Could not send the reset code. Check your internet connection and try again.');
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.textContent = 'SEND RESET CODE'; }
        });
};

window.verifyResetCode = async function () {
    const enteredOtp = document.getElementById('adm-forgot-otp').value.trim();
    const newPass = document.getElementById('adm-forgot-newpassword').value.trim();
    const savedOtp = localStorage.getItem('ajs_reset_otp');
    const expiry = Number(localStorage.getItem('ajs_reset_otp_expiry') || 0);

    if (!enteredOtp || !newPass) {
        alert('Please enter both the code and a new password.');
        return;
    }
    if (newPass.length < 4) {
        alert('Password should be at least 4 characters.');
        return;
    }
    if (!savedOtp || Date.now() > expiry) {
        alert('This code has expired. Please request a new one.');
        return;
    }
    if (enteredOtp !== savedOtp) {
        alert('Incorrect code. Please check your email and try again.');
        return;
    }

    try {
        await set(ref(db, 'settings/adminPassword'), newPass);
        adminPassword = newPass;
    } catch (error) {
        console.error('Error saving password:', error);
        alert('Could not save password. Check your internet connection.');
        return;
    }
    localStorage.removeItem('ajs_reset_otp');
    localStorage.removeItem('ajs_reset_otp_expiry');

    alert('Password successfully reset! You can now log in with your new password.');
    toggleForgotPassword(false);
};

// ==========================================
// RESIDENT AUTHENTICATION (Room Number + Phone Number match)
// ==========================================
window.toggleResidentForgot = function (show) {
    document.getElementById('rp-login-form').classList.toggle('hidden', show);
    document.getElementById('rp-forgot-form').classList.toggle('hidden', !show);
};

window.residentResetPassword = async function () {
    const room = document.getElementById('rp-forgot-room').value.trim().toLowerCase();
    const newPass = document.getElementById('rp-forgot-newpassword').value.trim();

    if (!room || !newPass) { alert('Enter room number and a new password.'); return; }
    if (newPass.length < 4) { alert('Password should be at least 4 characters.'); return; }

    const matchId = Object.keys(residentsData).find(id =>
        (residentsData[id].room || '').trim().toLowerCase() === room
    );
    if (!matchId) { alert('Room number not found.'); return; }

    try {
        await set(ref(db, `residents/${matchId}/password`), newPass);
        residentsData[matchId].password = newPass;
        alert('Password reset! You can now log in.');
        toggleResidentForgot(false);
    } catch (error) {
        console.error('Error resetting password:', error);
        alert('Could not reset password. Check your internet connection.');
    }
};

document.getElementById('rp-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const room = document.getElementById('rp-login-room').value.trim().toLowerCase();
    const pass = document.getElementById('rp-login-phone').value.trim();

    const matchId = Object.keys(residentsData).find(id =>
        (residentsData[id].room || '').trim().toLowerCase() === room
    );

    if (!matchId) {
        document.getElementById('rp-login-error').classList.remove('hidden');
        return;
    }

    const resident = residentsData[matchId];
    if (!resident.password) {
        // First login: set their password
        try {
            await set(ref(db, `residents/${matchId}/password`), pass);
            resident.password = pass;
        } catch (error) {
            console.error('Error setting password:', error);
            alert('Could not save password. Check your internet connection.');
            return;
        }
    } else if (resident.password !== pass) {
        document.getElementById('rp-login-error').classList.remove('hidden');
        return;
    }

    currentResidentId = matchId;
    localStorage.setItem('ajs_session_role', 'resident');
    localStorage.setItem('ajs_session_resident_id', matchId);
    document.getElementById('rp-login-error').classList.add('hidden');
    document.getElementById('rp-login-screen').classList.add('hidden');
    document.getElementById('rp-app-dashboard').classList.remove('hidden');
    renderHome();
    renderPayments();
    residentRenderComplaints();
    residentRenderNotices();
    renderProfile();
});

// ==========================================
// SESSION RESTORE (stay signed in until explicit logout)
// ==========================================
function restoreSession() {
    const savedRole = localStorage.getItem('ajs_session_role');
    if (savedRole === 'admin') {
        document.getElementById('role-select-screen').classList.add('hidden');
        document.getElementById('adm-app-dashboard').classList.remove('hidden');
    } else if (savedRole === 'resident') {
        const savedId = localStorage.getItem('ajs_session_resident_id');
        if (savedId) {
            currentResidentId = savedId;
            document.getElementById('role-select-screen').classList.add('hidden');
            document.getElementById('rp-app-dashboard').classList.remove('hidden');
        }
    }
}

// ==========================================
// AUTOMATIC EXCEL / CSV EXPORT (full database)
// ==========================================
function exportDatabaseToExcel() {
    let csvContent = "data:text/csv;charset=utf-8,";

    csvContent += "--- RESIDENTS ---\n";
    csvContent += "Resident ID,Name,Email,Phone,Room,Monthly Fee,Joining Date\n";
    Object.entries(residentsData).forEach(([id, res]) => {
        csvContent += `"${id}","${res.name}","${res.email || ''}","${res.phone}","${res.room}","${res.monthlyFee}","${res.joiningDate}"\n`;
    });

    csvContent += "\n--- PAYMENTS ---\n";
    csvContent += "Payment ID,Resident ID,Month,Amount,Payment Date,Payment Method,Status\n";
    Object.entries(paymentsData).forEach(([id, pay]) => {
        csvContent += `"${id}","${pay.residentId}","${pay.month}","${pay.amount}","${pay.paymentDate}","${pay.paymentMethod}","${pay.status}"\n`;
    });

    csvContent += "\n--- ROOMS ---\n";
    csvContent += "Room ID,Room Number,Floor,Capacity\n";
    Object.entries(roomsData).forEach(([id, r]) => {
        csvContent += `"${id}","${r.roomNumber}","${r.floor || ''}","${r.capacity}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `AJS_Hostel_Database_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
window.exportDatabaseToExcel = exportDatabaseToExcel;

function exportDatabaseToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 18;

    doc.setFontSize(16);
    doc.text("AJS Boys Hostel - Report", 14, y);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 14, y + 6);
    doc.setTextColor(0);
    y += 14;

    function ensureSpace(needed) {
        if (y + needed > pageHeight - 15) {
            doc.addPage();
            y = 18;
        }
    }

    function addSection(title, head, rows) {
        ensureSpace(20);
        doc.setFontSize(12);
        doc.text(title, 14, y);
        doc.autoTable({
            startY: y + 3,
            head: [head],
            body: rows,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [99, 102, 241] },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 10;
    }

    addSection("Residents", ['Name', 'Room', 'Phone', 'Monthly Fee'],
        Object.values(residentsData).map(r => [r.name, r.room, r.phone, `Rs.${Number(r.monthlyFee).toLocaleString('en-IN')}`]));

    addSection("Payments", ['Resident', 'Month', 'Amount', 'Method', 'Status'],
        Object.values(paymentsData).map(p => [
            residentsData[p.residentId] ? residentsData[p.residentId].name : '—',
            p.month, `Rs.${Number(p.amount).toLocaleString('en-IN')}`, p.paymentMethod, p.status
        ]));

    addSection("Rooms", ['Room No.', 'Floor', 'Capacity', 'Occupants'],
        Object.values(roomsData).map(r => [
            r.roomNumber, r.floor || '—', r.capacity,
            Object.values(residentsData).filter(res => res.room === r.roomNumber).length
        ]));

    addSection("Complaints", ['Subject', 'Resident', 'Priority', 'Status', 'Date'],
        Object.values(complaintsData).map(c => [
            c.subject,
            c.residentId && residentsData[c.residentId] ? residentsData[c.residentId].name : 'General',
            c.priority, c.status, c.date
        ]));

    addSection("Notices", ['Title', 'Message', 'Date'],
        Object.values(noticesData).map(n => [n.title, n.message, n.date]));

    doc.save(`AJS_Hostel_Report_${new Date().toISOString().split('T')[0]}.pdf`);
}
window.exportDatabaseToPDF = exportDatabaseToPDF;

// ==========================================
// EMAIL NOTIFICATION
// ==========================================
function sendReceiptEmail(resident, payment) {
    if (!resident.email) return;

    const templateParams = {
        to_email: resident.email,
        to_name: resident.name,
        room: resident.room,
        month: payment.month,
        amount: payment.amount.toLocaleString('en-IN'),
        payment_method: payment.paymentMethod,
        payment_date: payment.paymentDate,
        payment_id: payment.paymentId
    };

    emailjs.send('service_htvrcng', 'template_49ouyob', templateParams)
        .then((response) => console.log('Email successfully sent!', response.status, response.text),
              (error) => console.error('Failed to send email receipt.', error));
}

// ==========================================
// WHATSAPP PAYMENT REMINDER
// ==========================================
function buildReminderMessage(resident, month) {
    return `Hi ${resident.name}, this is a reminder from AJS Boys Hostel that your rent of Rs.${Number(resident.monthlyFee).toLocaleString('en-IN')} for ${month} (Room ${resident.room}) is pending. Kindly clear it at your earliest convenience. Thank you!`;
}

window.sendWhatsAppReminder = function (resId, month) {
    const res = residentsData[resId];
    if (!res || !res.phone) { alert('No phone number on file for this resident.'); return; }
    const digits = res.phone.replace(/\D/g, '');
    const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
    const msg = buildReminderMessage(res, month || getSelectedMonth());
    window.open(`https://wa.me/${withCountryCode}?text=${encodeURIComponent(msg)}`, '_blank');
};

// ==========================================
// DATA SYNCHRONIZATION WITH FIREBASE
// ==========================================
let seeded = false;

async function startRealtimeSync() {
    try {
        const dbRef = ref(db);
        const initialSnapshot = await get(dbRef);
        if (!initialSnapshot.exists() && !seeded) {
            seeded = true;
            await seedInitialData();
        }

        onValue(dbRef, (snapshot) => {
            const data = snapshot.val() || {};
            residentsData = data.residents || {};
            paymentsData = data.payments || {};
            roomsData = data.rooms || {};
            complaintsData = data.complaints || {};
            noticesData = data.notices || {};
            if (data.settings && data.settings.adminPassword) adminPassword = data.settings.adminPassword;

            populateResidentDropdowns();
            populateMonthDropdown();
            populateRoomDatalist();
            renderDashboard();
            renderRooms();
            adminRenderComplaints();
            adminRenderNotices();

            if (currentResidentId && residentsData[currentResidentId]) {
                renderHome();
                renderPayments();
                residentRenderComplaints();
                residentRenderNotices();
                renderProfile();
            }
        });
    } catch (error) {
        console.error("Error loading data from Firebase:", error);
    }
}

async function seedInitialData() {
    const defaultResidents = {
        "res_1": { name: "Rahul Kumar", email: "rahul@gmail.com", phone: "9876543210", room: "A-101", monthlyFee: 6500, joiningDate: "2026-05-01" },
        "res_2": { name: "Vamsi Kumar", email: "vamsi@gmail.com", phone: "9876543211", room: "A-102", monthlyFee: 6500, joiningDate: "2026-05-01" },
        "res_3": { name: "Anita Sharma", email: "anita@gmail.com", phone: "9876543212", room: "A-103", monthlyFee: 6500, joiningDate: "2026-06-01" },
        "res_4": { name: "Vikram Singh", email: "vikram@gmail.com", phone: "9876543213", room: "A-104", monthlyFee: 6500, joiningDate: "2026-06-01" }
    };

    const defaultPayments = {
        "pay_1": { residentId: "res_1", month: "August 2026", amount: 6500, paymentDate: "2026-08-01", paymentMethod: "UPI", status: "PAID", paymentId: "PAY-20260801-001" },
        "pay_2": { residentId: "res_1", month: "July 2026", amount: 6500, paymentDate: "2026-07-02", paymentMethod: "UPI", status: "PAID", paymentId: "PAY-20260702-002" },
        "pay_3": { residentId: "res_1", month: "June 2026", amount: 6500, paymentDate: "2026-06-01", paymentMethod: "Cash", status: "PAID", paymentId: "PAY-20260601-003" },
        "pay_4": { residentId: "res_1", month: "May 2026", amount: 6500, paymentDate: "2026-05-05", paymentMethod: "Bank Transfer", status: "PENDING", paymentId: "PAY-20260505-004" }
    };

    const defaultRooms = {
        "room_1": { roomNumber: "A-101", floor: "1st Floor", capacity: 2 },
        "room_2": { roomNumber: "A-102", floor: "1st Floor", capacity: 2 },
        "room_3": { roomNumber: "A-103", floor: "1st Floor", capacity: 3 },
        "room_4": { roomNumber: "A-104", floor: "2nd Floor", capacity: 2 }
    };

    await set(ref(db, 'residents'), defaultResidents);
    await set(ref(db, 'payments'), defaultPayments);
    await set(ref(db, 'rooms'), defaultRooms);

    residentsData = defaultResidents;
    paymentsData = defaultPayments;
    roomsData = defaultRooms;
    complaintsData = {};
    noticesData = {};
}

// ==========================================
// HELPERS
// ==========================================
function getSelectedMonth() {
    const filterInput = document.getElementById('adm-filter-month')._flatpickr;
    if (filterInput && filterInput.selectedDates.length > 0) {
        return filterInput.selectedDates[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function populateMonthDropdown() {
    const select = document.getElementById('adm-pay-month');
    select.innerHTML = '';
    MONTH_OPTIONS.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        if (m === getSelectedMonth()) opt.selected = true;
        select.appendChild(opt);
    });
}

function populateRoomDatalist() {
    const list = document.getElementById('adm-room-options');
    list.innerHTML = '';
    Object.values(roomsData).forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.roomNumber;
        list.appendChild(opt);
    });
}

// ==========================================
// RENDER DASHBOARD & METRICS (HOME TAB)
// ==========================================
window.renderDashboard = function () {
    const selectedMonth = getSelectedMonth();
    const selectedStatus = document.getElementById('adm-filter-status').value;
    const searchQuery = document.getElementById('adm-search-input').value.toLowerCase();

    const residentIds = Object.keys(residentsData);
    let totalResidentsCount = residentIds.length;
    let totalCollectionAmount = 0;
    let paidCount = 0;
    let pendingCount = 0;

    let htmlContent = '';

    residentIds.forEach(resId => {
        const res = residentsData[resId];
        const paymentsList = Object.values(paymentsData);
        const currentMonthPayment = paymentsList.find(p => p.residentId === resId && p.month === selectedMonth);
        const status = currentMonthPayment ? currentMonthPayment.status : 'PENDING';
        const amountDisplay = currentMonthPayment ? currentMonthPayment.amount : res.monthlyFee;

        if (status === 'PAID') {
            paidCount++;
            totalCollectionAmount += Number(amountDisplay);
        } else {
            pendingCount++;
        }

        const matchesSearch = res.name.toLowerCase().includes(searchQuery) || res.room.toLowerCase().includes(searchQuery);
        const matchesStatus = selectedStatus === 'All' || status === selectedStatus;

        if (matchesSearch && matchesStatus) {
            const statusBadge = status === 'PAID'
                ? `<span class="flex items-center gap-1 font-bold" style="color:var(--emerald);"><i class="fa-solid fa-circle-check"></i>PAID</span>`
                : `<span class="flex items-center gap-1 font-bold" style="color:var(--amber);"><i class="fa-solid fa-hourglass-half"></i>PENDING</span>`;

            const remindBtn = status !== 'PAID'
                ? `<button onclick="event.stopPropagation(); sendWhatsAppReminder('${resId}','${selectedMonth}')" class="mt-1 text-[10px] font-semibold px-2 py-1 rounded-lg" style="background:rgba(37,211,102,0.15); color:#25D366;"><i class="fa-brands fa-whatsapp mr-1"></i>Remind</button>`
                : '';

            htmlContent += `
                <div onclick="openResidentHistory('${resId}')" class="glass p-3.5 rounded-xl cursor-pointer transition flex justify-between items-center active:scale-[0.99]">
                    <div>
                        <h4 class="font-bold text-sm">${res.name}</h4>
                        <p class="text-xs" style="color:var(--muted);">Room: ${res.room}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-sm">₹${Number(amountDisplay).toLocaleString('en-IN')}</p>
                        <div class="text-xs mt-0.5">${statusBadge}</div>
                        ${remindBtn}
                    </div>
                </div>
            `;
        }
    });

    document.getElementById('adm-residents-list').innerHTML = htmlContent || `<p class="text-center text-xs py-6" style="color:var(--muted);">No residents found.</p>`;

    document.getElementById('adm-stat-residents').innerText = totalResidentsCount;
    document.getElementById('adm-stat-collection').innerText = `₹${totalCollectionAmount.toLocaleString('en-IN')}`;
    document.getElementById('adm-stat-paid').innerText = paidCount;
    document.getElementById('adm-stat-pending').innerText = pendingCount;

    // Progress ring
    const pct = totalResidentsCount > 0 ? Math.round((paidCount / totalResidentsCount) * 100) : 0;
    const circumference = 263.9;
    const offset = circumference - (pct / 100) * circumference;
    document.getElementById('adm-ring-progress').style.strokeDashoffset = offset;
    document.getElementById('adm-ring-pct').innerText = `${pct}%`;

    // Rooms full stat
    const roomList = Object.values(roomsData);
    const fullRooms = roomList.filter(r => getRoomOccupantCount(r.roomNumber) >= Number(r.capacity)).length;
    document.getElementById('adm-stat-rooms-full').innerText = `${fullRooms}/${roomList.length}`;
};

function getRoomOccupantCount(roomNumber) {
    return Object.values(residentsData).filter(r => r.room === roomNumber).length;
}

// ==========================================
// MODAL CONTROLS
// ==========================================
window.openAddPaymentModal = function () {
    populateMonthDropdown();
    document.getElementById('adm-modal-payment').classList.remove('hidden');
};

window.openAddResidentModal = function () {
    document.getElementById('adm-resident-modal-title').innerHTML = '<i class="fa-solid fa-user-plus mr-2" style="color:var(--cyan);"></i>Add New Resident';
    document.getElementById('adm-resident-form').reset();
    document.getElementById('adm-edit-res-id').value = '';
    populateRoomDatalist();
    document.getElementById('adm-modal-resident').classList.remove('hidden');
};

function populateResidentDropdowns() {
    const select = document.getElementById('adm-pay-resident-id');
    select.innerHTML = '';
    Object.keys(residentsData).forEach(resId => {
        const res = residentsData[resId];
        const opt = document.createElement('option');
        opt.value = resId;
        opt.textContent = `${res.name} (${res.room})`;
        select.appendChild(opt);
    });

    const complaintSelect = document.getElementById('adm-complaint-resident-id');
    complaintSelect.innerHTML = '<option value="">General / Common Area</option>';
    Object.keys(residentsData).forEach(resId => {
        const res = residentsData[resId];
        const opt = document.createElement('option');
        opt.value = resId;
        opt.textContent = `${res.name} (${res.room})`;
        complaintSelect.appendChild(opt);
    });
}

// ==========================================
// SAVE PAYMENT & SEND EMAIL & AUTO-EXPORT
// ==========================================
window.handleSavePayment = async function (e) {
    e.preventDefault();
    const residentId = document.getElementById('adm-pay-resident-id').value;
    const month = document.getElementById('adm-pay-month').value;
    const amount = Number(document.getElementById('adm-pay-amount').value);
    const paymentMethod = document.getElementById('adm-pay-method').value;
    const paymentDate = document.getElementById('adm-pay-date').value;

    const paymentId = `PAY-${paymentDate.replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const newPayment = { residentId, month, amount, paymentDate, paymentMethod, status: 'PAID', paymentId };

    try {
        const newPaymentRef = push(ref(db, 'payments'));
        await set(newPaymentRef, newPayment);
        paymentsData[newPaymentRef.key] = newPayment;

        closeModal('adm-modal-payment');
        renderDashboard();

        const resident = residentsData[residentId];
        sendReceiptEmail(resident, newPayment);

        showReceipt(newPayment);
        document.getElementById('adm-payment-form').reset();
    } catch (error) {
        console.error("Error saving payment:", error);
        alert("Failed to save payment.");
    }
};

// ==========================================
// SAVE / EDIT RESIDENT
// ==========================================
window.handleSaveResident = async function (e) {
    e.preventDefault();
    const editId = document.getElementById('adm-edit-res-id').value;
    const name = document.getElementById('adm-res-name').value;
    const email = document.getElementById('adm-res-email').value;
    const phone = document.getElementById('adm-res-phone').value;
    const room = document.getElementById('adm-res-room').value;
    const monthlyFee = Number(document.getElementById('adm-res-fee').value);
    const joiningDate = new Date().toISOString().split('T')[0];

    try {
        if (editId) {
            const resRef = ref(db, `residents/${editId}`);
            const updatedData = { ...residentsData[editId], name, email, phone, room, monthlyFee };
            await set(resRef, updatedData);
            residentsData[editId] = updatedData;
        } else {
            const newResRef = push(ref(db, 'residents'));
            const newRes = { name, email, phone, room, monthlyFee, joiningDate };
            await set(newResRef, newRes);
            residentsData[newResRef.key] = newRes;
        }

        closeModal('adm-modal-resident');
        closeModal('adm-modal-history');
        populateResidentDropdowns();
        renderDashboard();
        document.getElementById('adm-resident-form').reset();
    } catch (error) {
        console.error("Error saving resident:", error);
        alert("Failed to save resident.");
    }
};

// ==========================================
// DELETE RESIDENT
// ==========================================
window.deleteResident = async function (resId) {
    if (confirm("Are you sure you want to delete this resident and their associated data?")) {
        try {
            await remove(ref(db, `residents/${resId}`));
            delete residentsData[resId];

            for (const [payId, payment] of Object.entries(paymentsData)) {
                if (payment.residentId === resId) {
                    await remove(ref(db, `payments/${payId}`));
                    delete paymentsData[payId];
                }
            }

            closeModal('adm-modal-history');
            populateResidentDropdowns();
            renderDashboard();
        } catch (error) {
            console.error("Error deleting resident:", error);
            alert("Failed to delete resident.");
        }
    }
};

// ==========================================
// OPEN EDIT RESIDENT MODAL
// ==========================================
window.openEditResidentModal = function (resId) {
    const res = residentsData[resId];
    document.getElementById('adm-resident-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square mr-2" style="color:var(--amber);"></i>Edit Resident Details';
    document.getElementById('adm-edit-res-id').value = resId;
    document.getElementById('adm-res-name').value = res.name;
    document.getElementById('adm-res-email').value = res.email || '';
    document.getElementById('adm-res-phone').value = res.phone;
    document.getElementById('adm-res-room').value = res.room;
    document.getElementById('adm-res-fee').value = res.monthlyFee;

    populateRoomDatalist();
    document.getElementById('adm-modal-history').classList.add('hidden');
    document.getElementById('adm-modal-resident').classList.remove('hidden');
};

// ==========================================
// RESIDENT PAYMENT HISTORY DRAWER
// ==========================================
window.openResidentHistory = function (resId) {
    const res = residentsData[resId];
    document.getElementById('adm-hist-name').textContent = res.name;
    document.getElementById('adm-hist-meta').textContent = `Room: ${res.room} | Monthly Fee: ₹${res.monthlyFee.toLocaleString('en-IN')}`;
    document.getElementById('adm-hist-email').textContent = `Email: ${res.email || 'Not provided'}`;

    document.getElementById('adm-btn-edit-resident').setAttribute('onclick', `openEditResidentModal('${resId}')`);
    document.getElementById('adm-btn-delete-resident').setAttribute('onclick', `deleteResident('${resId}')`);
    document.getElementById('adm-btn-remind-resident').setAttribute('onclick', `sendWhatsAppReminder('${resId}', '${getSelectedMonth()}')`);

    let startDate = res.joiningDate ? new Date(res.joiningDate) : new Date(2025, 0, 1);
    let currentDate = new Date();

    let monthsList = [];
    let iterDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    let limitDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 1);

    while (iterDate <= limitDate) {
        const monthName = iterDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (!monthsList.includes(monthName)) monthsList.unshift(monthName);
        iterDate.setMonth(iterDate.getMonth() + 1);
    }

    Object.values(paymentsData).forEach(p => {
        if (p.residentId === resId && !monthsList.includes(p.month)) monthsList.unshift(p.month);
    });

    let historyHtml = '';
    monthsList.forEach(month => {
        const payment = Object.values(paymentsData).find(p => p.residentId === resId && p.month === month);
        const isPaid = payment && payment.status === 'PAID';
        const amount = payment ? payment.amount : res.monthlyFee;
        const icon = isPaid
            ? `<span style="color:var(--emerald);" class="font-bold">✅</span>`
            : `<span style="color:var(--rose);" class="font-bold">❌</span>`;

        historyHtml += `
            <div class="flex justify-between items-center p-2.5 glass rounded-lg text-xs">
                <span class="font-medium">${month}</span>
                <div class="flex items-center space-x-3">
                    <span class="font-semibold">₹${amount.toLocaleString('en-IN')}</span>
                    ${icon}
                </div>
            </div>
        `;
    });

    document.getElementById('adm-hist-list').innerHTML = historyHtml;
    document.getElementById('adm-modal-history').classList.remove('hidden');
};

// ==========================================
// RECEIPT VIEW & PRINT
// ==========================================
function showReceipt(payment) {
    const res = residentsData[payment.residentId];
    document.getElementById('adm-rec-name').textContent = res.name;
    document.getElementById('adm-rec-room').textContent = res.room;
    document.getElementById('adm-rec-month').textContent = payment.month;
    document.getElementById('adm-rec-amount').textContent = payment.amount.toLocaleString('en-IN');
    document.getElementById('adm-rec-method').textContent = payment.paymentMethod;

    const d = new Date(payment.paymentDate);
    const formattedDate = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('adm-rec-date').textContent = formattedDate;
    document.getElementById('adm-rec-id').textContent = `Payment ID: ${payment.paymentId}`;

    document.getElementById('adm-modal-receipt').classList.remove('hidden');
}

window.printReceipt = function () { window.print(); };

// ==========================================
// ROOMS / VACANCY MANAGER
// ==========================================
window.openAddRoomModal = function () {
    document.getElementById('adm-room-modal-title').innerHTML = '<i class="fa-solid fa-door-open mr-2" style="color:var(--cyan);"></i>Add Room';
    document.getElementById('adm-room-form').reset();
    document.getElementById('adm-edit-room-id').value = '';
    document.getElementById('adm-modal-room').classList.remove('hidden');
};

window.openEditRoomModal = function (roomId) {
    const r = roomsData[roomId];
    document.getElementById('adm-room-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square mr-2" style="color:var(--amber);"></i>Edit Room';
    document.getElementById('adm-edit-room-id').value = roomId;
    document.getElementById('adm-room-number').value = r.roomNumber;
    document.getElementById('adm-room-floor').value = r.floor || '';
    document.getElementById('adm-room-capacity').value = r.capacity;
    document.getElementById('adm-modal-room').classList.remove('hidden');
};

window.handleSaveRoom = async function (e) {
    e.preventDefault();
    const editId = document.getElementById('adm-edit-room-id').value;
    const roomNumber = document.getElementById('adm-room-number').value;
    const floor = document.getElementById('adm-room-floor').value;
    const capacity = Number(document.getElementById('adm-room-capacity').value);

    try {
        if (editId) {
            await set(ref(db, `rooms/${editId}`), { roomNumber, floor, capacity });
            roomsData[editId] = { roomNumber, floor, capacity };
        } else {
            const newRef = push(ref(db, 'rooms'));
            await set(newRef, { roomNumber, floor, capacity });
            roomsData[newRef.key] = { roomNumber, floor, capacity };
        }
        closeModal('adm-modal-room');
        populateRoomDatalist();
        renderRooms();
        renderDashboard();
    } catch (error) {
        console.error("Error saving room:", error);
        alert("Failed to save room.");
    }
};

window.deleteRoom = async function (roomId) {
    if (confirm("Delete this room? Residents already assigned to it will not be affected.")) {
        try {
            await remove(ref(db, `rooms/${roomId}`));
            delete roomsData[roomId];
            populateRoomDatalist();
            renderRooms();
            renderDashboard();
        } catch (error) {
            console.error("Error deleting room:", error);
            alert("Failed to delete room.");
        }
    }
};

window.renderRooms = function () {
    const rooms = Object.entries(roomsData);
    let html = '';

    if (rooms.length === 0) {
        html = `<p class="text-center text-xs py-6" style="color:var(--muted);">No rooms added yet.</p>`;
    }

    rooms.sort((a, b) => a[1].roomNumber.localeCompare(b[1].roomNumber)).forEach(([roomId, r]) => {
        const occupants = Object.values(residentsData).filter(res => res.room === r.roomNumber);
        const count = occupants.length;
        const capacity = Number(r.capacity);
        const pct = capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0;

        let statusColor = 'var(--emerald)', statusText = 'Vacant';
        if (count >= capacity) { statusColor = 'var(--rose)'; statusText = 'Full'; }
        else if (count > 0) { statusColor = 'var(--amber)'; statusText = 'Partially Occupied'; }

        const occupantNames = occupants.map(o => o.name).join(', ') || 'No residents assigned';

        html += `
            <div class="glass rounded-xl p-3.5">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-bold text-sm">${r.roomNumber} <span class="text-[10px] font-normal" style="color:var(--muted);">${r.floor || ''}</span></h4>
                        <p class="text-[11px] mt-0.5" style="color:var(--muted);">${occupantNames}</p>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background:rgba(255,255,255,0.08); color:${statusColor};">${statusText}</span>
                </div>
                <div class="mt-2.5 flex items-center gap-2">
                    <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div class="h-full rounded-full" style="width:${pct}%; background:${statusColor};"></div>
                    </div>
                    <span class="text-[10px] font-semibold" style="color:var(--muted);">${count}/${capacity}</span>
                </div>
                <div class="flex gap-2 mt-3">
                    <button onclick="openEditRoomModal('${roomId}')" class="w-1/2 py-1.5 text-[11px] font-semibold rounded-lg glass"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit</button>
                    <button onclick="deleteRoom('${roomId}')" class="w-1/2 py-1.5 text-[11px] font-semibold rounded-lg text-white" style="background:var(--rose);"><i class="fa-solid fa-trash-can mr-1"></i>Delete</button>
                </div>
            </div>
        `;
    });

    document.getElementById('adm-rooms-list').innerHTML = html;
};

// ==========================================
// COMPLAINTS & MAINTENANCE
// ==========================================
window.openAddComplaintModal = function () {
    document.getElementById('adm-complaint-form').reset();
    document.getElementById('adm-modal-complaint').classList.remove('hidden');
};

window.handleSaveComplaint = async function (e) {
    e.preventDefault();
    const residentId = document.getElementById('adm-complaint-resident-id').value;
    const subject = document.getElementById('adm-complaint-subject').value;
    const description = document.getElementById('adm-complaint-desc').value;
    const priority = document.getElementById('adm-complaint-priority').value;
    const date = new Date().toISOString().split('T')[0];

    const newComplaint = { residentId, subject, description, priority, status: 'OPEN', date };

    try {
        const newRef = push(ref(db, 'complaints'));
        await set(newRef, newComplaint);
        complaintsData[newRef.key] = newComplaint;

        closeModal('adm-modal-complaint');
        adminRenderComplaints();
    } catch (error) {
        console.error("Error saving complaint:", error);
        alert("Failed to log complaint.");
    }
};

window.updateComplaintStatus = async function (compId, newStatus) {
    try {
        const updated = { ...complaintsData[compId], status: newStatus };
        await set(ref(db, `complaints/${compId}`), updated);
        complaintsData[compId] = updated;
        adminRenderComplaints();
    } catch (error) {
        console.error("Error updating complaint:", error);
        alert("Failed to update complaint.");
    }
};

window.deleteComplaint = async function (compId) {
    if (confirm("Delete this complaint record?")) {
        try {
            await remove(ref(db, `complaints/${compId}`));
            delete complaintsData[compId];
            adminRenderComplaints();
        } catch (error) {
            console.error("Error deleting complaint:", error);
            alert("Failed to delete complaint.");
        }
    }
};

const STATUS_STYLES = {
    "OPEN": { color: "var(--rose)", label: "Open" },
    "IN_PROGRESS": { color: "var(--amber)", label: "In Progress" },
    "RESOLVED": { color: "var(--emerald)", label: "Resolved" }
};

window.adminRenderComplaints = function () {
    const filter = document.getElementById('adm-complaint-filter-status').value;
    let entries = Object.entries(complaintsData);
    if (filter !== 'All') entries = entries.filter(([, c]) => c.status === filter);
    entries.sort((a, b) => new Date(b[1].date) - new Date(a[1].date));

    let html = '';
    if (entries.length === 0) {
        html = `<p class="text-center text-xs py-6" style="color:var(--muted);">No complaints found.</p>`;
    }

    entries.forEach(([compId, c]) => {
        const residentName = c.residentId && residentsData[c.residentId] ? residentsData[c.residentId].name : 'General / Common Area';
        const style = STATUS_STYLES[c.status] || STATUS_STYLES.OPEN;
        const priorityBadge = c.priority === 'Urgent'
            ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:rgba(251,113,133,0.18); color:var(--rose);">URGENT</span>`
            : (c.priority === 'High' ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:rgba(245,158,11,0.18); color:var(--amber);">HIGH</span>` : '');

        html += `
            <div class="glass rounded-xl p-3.5">
                <div class="flex justify-between items-start mb-1.5">
                    <div>
                        <div class="flex items-center gap-1.5">
                            <h4 class="font-bold text-sm">${c.subject}</h4>
                            ${priorityBadge}
                        </div>
                        <p class="text-[11px] mt-0.5" style="color:var(--muted);">${residentName} · ${c.date}</p>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background:rgba(255,255,255,0.08); color:${style.color};">${style.label}</span>
                </div>
                ${c.description ? `<p class="text-xs mt-1" style="color:var(--muted);">${c.description}</p>` : ''}
                <div class="flex gap-2 mt-3">
                    <select onchange="updateComplaintStatus('${compId}', this.value)" class="flex-1 text-[11px] rounded-lg px-2 py-1.5 focus:outline-none">
                        <option value="OPEN" ${c.status === 'OPEN' ? 'selected' : ''}>Open</option>
                        <option value="IN_PROGRESS" ${c.status === 'IN_PROGRESS' ? 'selected' : ''}>In Progress</option>
                        <option value="RESOLVED" ${c.status === 'RESOLVED' ? 'selected' : ''}>Resolved</option>
                    </select>
                    <button onclick="deleteComplaint('${compId}')" class="px-3 rounded-lg text-xs text-white" style="background:var(--rose);"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `;
    });

    document.getElementById('adm-complaints-list').innerHTML = html;
};

// ==========================================
// NOTICES & ANNOUNCEMENTS
// ==========================================
window.openAddNoticeModal = function () {
    document.getElementById('adm-notice-form').reset();
    document.getElementById('adm-modal-notice').classList.remove('hidden');
};

window.handleSaveNotice = async function (e) {
    e.preventDefault();
    const title = document.getElementById('adm-notice-title').value;
    const message = document.getElementById('adm-notice-message').value;
    const date = new Date().toISOString().split('T')[0];

    const newNotice = { title, message, date };

    try {
        const newRef = push(ref(db, 'notices'));
        await set(newRef, newNotice);
        noticesData[newRef.key] = newNotice;

        closeModal('adm-modal-notice');
        adminRenderNotices();
    } catch (error) {
        console.error("Error posting notice:", error);
        alert("Failed to post notice.");
    }
};

window.deleteNotice = async function (noticeId) {
    if (confirm("Delete this notice?")) {
        try {
            await remove(ref(db, `notices/${noticeId}`));
            delete noticesData[noticeId];
            adminRenderNotices();
        } catch (error) {
            console.error("Error deleting notice:", error);
            alert("Failed to delete notice.");
        }
    }
};

window.adminRenderNotices = function () {
    const entries = Object.entries(noticesData).sort((a, b) => new Date(b[1].date) - new Date(a[1].date));
    let html = '';

    if (entries.length === 0) {
        html = `<p class="text-center text-xs py-6" style="color:var(--muted);">No notices posted yet.</p>`;
    }

    entries.forEach(([noticeId, n]) => {
        html += `
            <div class="glass rounded-xl p-3.5">
                <div class="flex justify-between items-start">
                    <div class="flex items-start gap-2.5">
                        <span class="w-8 h-8 rounded-lg btn-grad flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fa-solid fa-bullhorn text-white text-xs"></i></span>
                        <div>
                            <h4 class="font-bold text-sm">${n.title}</h4>
                            <p class="text-xs mt-1" style="color:var(--muted);">${n.message}</p>
                            <p class="text-[10px] mt-1.5" style="color:#5B6480;">${n.date}</p>
                        </div>
                    </div>
                    <button onclick="deleteNotice('${noticeId}')" class="text-xs flex-shrink-0" style="color:var(--muted);"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `;
    });

    document.getElementById('adm-notices-list').innerHTML = html;
};

// ==========================================
// RESIDENT PORTAL: TAB NAVIGATION
// ==========================================
// ==========================================
// TAB NAVIGATION
// ==========================================
window.residentSwitchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

    if (tabId === 'rp-tab-payments') renderPayments();
    if (tabId === 'rp-tab-issues') residentRenderComplaints();
    if (tabId === 'rp-tab-notices') residentRenderNotices();
    if (tabId === 'rp-tab-profile') renderProfile();
};

// ==========================================
// RESIDENT PORTAL: FUNCTIONS
// ==========================================
// ==========================================
// HOME TAB
// ==========================================
function getCurrentMonthLabel() {
    return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function renderHome() {
    const res = residentsData[currentResidentId];
    document.getElementById('rp-home-name').textContent = res.name;
    document.getElementById('rp-home-room').textContent = `Room ${res.room}`;

    const month = getCurrentMonthLabel();
    const payment = Object.values(paymentsData).find(p => p.residentId === currentResidentId && p.month === month);
    const isPaid = payment && payment.status === 'PAID';
    const amount = payment ? payment.amount : res.monthlyFee;

    document.getElementById('rp-home-amount').textContent = `₹${Number(amount).toLocaleString('en-IN')}`;
    document.getElementById('rp-home-month').textContent = month;

    const badge = document.getElementById('rp-home-status-badge');
    if (isPaid) {
        badge.textContent = 'PAID';
        badge.style.background = 'rgba(52,211,153,0.15)';
        badge.style.color = 'var(--emerald)';
    } else {
        badge.textContent = 'PENDING';
        badge.style.background = 'rgba(245,158,11,0.15)';
        badge.style.color = 'var(--amber)';
    }
}

// ==========================================
// PAYMENTS TAB
// ==========================================
window.renderPayments = function () {
    const res = residentsData[currentResidentId];
    let startDate = res.joiningDate ? new Date(res.joiningDate) : new Date(2025, 0, 1);
    let currentDate = new Date();

    let monthsList = [];
    let iterDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    let limitDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    while (iterDate <= limitDate) {
        const monthName = iterDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (!monthsList.includes(monthName)) monthsList.unshift(monthName);
        iterDate.setMonth(iterDate.getMonth() + 1);
    }
    Object.values(paymentsData).forEach(p => {
        if (p.residentId === currentResidentId && !monthsList.includes(p.month)) monthsList.unshift(p.month);
    });

    let html = '';
    monthsList.forEach(month => {
        const payment = Object.values(paymentsData).find(p => p.residentId === currentResidentId && p.month === month);
        const isPaid = payment && payment.status === 'PAID';
        const amount = payment ? payment.amount : res.monthlyFee;

        const badge = isPaid
            ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background:rgba(52,211,153,0.15); color:var(--emerald);">PAID</span>`
            : `<span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background:rgba(245,158,11,0.15); color:var(--amber);">PENDING</span>`;

        const receiptBtn = isPaid
            ? `<button onclick="viewReceipt('${payment.paymentId}')" class="text-[10px] font-semibold mt-1" style="color:var(--cyan);"><i class="fa-solid fa-receipt mr-1"></i>View Receipt</button>`
            : '';

        html += `
            <div class="glass p-3.5 rounded-xl flex justify-between items-center">
                <div>
                    <h4 class="font-bold text-sm">${month}</h4>
                    <p class="text-xs" style="color:var(--muted);">₹${Number(amount).toLocaleString('en-IN')}</p>
                    ${receiptBtn}
                </div>
                ${badge}
            </div>
        `;
    });

    document.getElementById('rp-payments-list').innerHTML = html || `<p class="text-center text-xs py-6" style="color:var(--muted);">No payment history yet.</p>`;
};

window.viewReceipt = function (paymentId) {
    const payment = Object.values(paymentsData).find(p => p.paymentId === paymentId);
    if (!payment) return;
    const res = residentsData[currentResidentId];

    document.getElementById('rp-rec-name').textContent = res.name;
    document.getElementById('rp-rec-room').textContent = res.room;
    document.getElementById('rp-rec-month').textContent = payment.month;
    document.getElementById('rp-rec-amount').textContent = Number(payment.amount).toLocaleString('en-IN');
    document.getElementById('rp-rec-method').textContent = payment.paymentMethod;

    const d = new Date(payment.paymentDate);
    document.getElementById('rp-rec-date').textContent = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('rp-rec-id').textContent = `Payment ID: ${payment.paymentId}`;

    document.getElementById('rp-modal-receipt').classList.remove('hidden');
};

// ==========================================
// COMPLAINTS TAB
// ==========================================
window.openComplaintModal = function () {
    document.getElementById('rp-complaint-form').reset();
    document.getElementById('rp-modal-complaint').classList.remove('hidden');
};

window.handleSubmitComplaint = async function (e) {
    e.preventDefault();
    const subject = document.getElementById('rp-complaint-subject').value;
    const description = document.getElementById('rp-complaint-desc').value;
    const priority = document.getElementById('rp-complaint-priority').value;
    const date = new Date().toISOString().split('T')[0];

    const newComplaint = { residentId: currentResidentId, subject, description, priority, status: 'OPEN', date };

    try {
        const newId = `comp_${Date.now()}`;
        await set(ref(db, `complaints/${newId}`), newComplaint);
        complaintsData[newId] = newComplaint;

        closeModal('rp-modal-complaint');
        residentRenderComplaints();
    } catch (error) {
        console.error('Error submitting complaint:', error);
        alert('Failed to submit complaint. Check your internet connection.');
    }
};

window.residentRenderComplaints = function () {
    const entries = Object.entries(complaintsData)
        .filter(([, c]) => c.residentId === currentResidentId)
        .sort((a, b) => new Date(b[1].date) - new Date(a[1].date));

    let html = '';
    if (entries.length === 0) {
        html = `<p class="text-center text-xs py-6" style="color:var(--muted);">You haven't raised any complaints yet.</p>`;
    }

    entries.forEach(([, c]) => {
        const style = STATUS_STYLES[c.status] || STATUS_STYLES.OPEN;
        html += `
            <div class="glass rounded-xl p-3.5">
                <div class="flex justify-between items-start mb-1">
                    <h4 class="font-bold text-sm">${c.subject}</h4>
                    <span class="text-[10px] font-bold px-2 py-1 rounded-full" style="background:rgba(255,255,255,0.08); color:${style.color};">${style.label}</span>
                </div>
                <p class="text-[11px]" style="color:var(--muted);">${c.date}</p>
                ${c.description ? `<p class="text-xs mt-1" style="color:var(--muted);">${c.description}</p>` : ''}
            </div>
        `;
    });

    document.getElementById('rp-complaints-list').innerHTML = html;
};

// ==========================================
// NOTICES TAB
// ==========================================
window.residentRenderNotices = function () {
    const entries = Object.entries(noticesData).sort((a, b) => new Date(b[1].date) - new Date(a[1].date));
    let html = '';

    if (entries.length === 0) {
        html = `<p class="text-center text-xs py-6" style="color:var(--muted);">No notices posted yet.</p>`;
    }

    entries.forEach(([, n]) => {
        html += `
            <div class="glass rounded-xl p-3.5">
                <div class="flex items-start gap-2.5">
                    <span class="w-8 h-8 rounded-lg btn-grad flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fa-solid fa-bullhorn text-white text-xs"></i></span>
                    <div>
                        <h4 class="font-bold text-sm">${n.title}</h4>
                        <p class="text-xs mt-1" style="color:var(--muted);">${n.message}</p>
                        <p class="text-[10px] mt-1.5" style="color:#5B6480;">${n.date}</p>
                    </div>
                </div>
            </div>
        `;
    });

    document.getElementById('rp-notices-list').innerHTML = html;
};

// ==========================================
// PROFILE TAB
// ==========================================
window.renderProfile = function () {
    const res = residentsData[currentResidentId];
    document.getElementById('rp-prof-name').textContent = res.name;
    document.getElementById('rp-prof-email').textContent = res.email || 'Not provided';
    document.getElementById('rp-prof-phone').textContent = res.phone;
    document.getElementById('rp-prof-fee').textContent = `₹${Number(res.monthlyFee).toLocaleString('en-IN')}`;

    const room = Object.values(roomsData).find(r => r.roomNumber === res.room);
    document.getElementById('rp-room-info').textContent = room
        ? `Room ${room.roomNumber} · ${room.floor || ''} · Capacity ${room.capacity}`
        : `Room ${res.room}`;

    const roommates = Object.entries(residentsData).filter(([id, r]) => r.room === res.room && id !== currentResidentId);
    const roommatesHtml = roommates.length
        ? roommates.map(([, r]) => `<p class="text-xs glass rounded-lg px-2.5 py-1.5"><i class="fa-solid fa-user mr-1.5" style="color:var(--cyan);"></i>${r.name}</p>`).join('')
        : `<p class="text-xs" style="color:var(--muted);">No roommates currently.</p>`;
    document.getElementById('rp-roommates-list').innerHTML = roommatesHtml;
};

window.toggleProfileEdit = function (show) {
    if (show) {
        const res = residentsData[currentResidentId];
        document.getElementById('rp-edit-email').value = res.email || '';
        document.getElementById('rp-edit-phone').value = res.phone || '';
        document.getElementById('rp-profile-view').classList.add('hidden');
        document.getElementById('rp-btn-edit-profile').classList.add('hidden');
        document.getElementById('rp-profile-form').classList.remove('hidden');
    } else {
        document.getElementById('rp-profile-view').classList.remove('hidden');
        document.getElementById('rp-btn-edit-profile').classList.remove('hidden');
        document.getElementById('rp-profile-form').classList.add('hidden');
    }
};

window.togglePayQR = function (show) {
    document.getElementById('rp-pay-qr-box').classList.toggle('hidden', !show);
    if (show) {
        const amount = document.getElementById('rp-home-amount').textContent.replace(/[^0-9]/g, '');
        const upiLink = `upi://pay?pa=8978432933@ybl&pn=AJS%20Boys%20Hostel&am=${amount}&cu=INR`;
        document.getElementById('rp-upi-link').href = upiLink;
    }
};

window.togglePasswordReset = function (show) {
    document.getElementById('rp-pw-view').classList.toggle('hidden', show);
    document.getElementById('rp-pw-form').classList.toggle('hidden', !show);
};

window.handleProfilePasswordReset = async function (e) {
    e.preventDefault();
    const newPass = document.getElementById('rp-new-password').value.trim();
    if (newPass.length < 4) { alert('Password should be at least 4 characters.'); return; }

    try {
        await set(ref(db, `residents/${currentResidentId}/password`), newPass);
        residentsData[currentResidentId].password = newPass;
        alert('Password changed successfully!');
        document.getElementById('rp-pw-form').reset();
        togglePasswordReset(false);
    } catch (error) {
        console.error('Error changing password:', error);
        alert('Could not change password. Check your internet connection.');
    }
};

window.handleProfileSave = async function (e) {
    e.preventDefault();
    const email = document.getElementById('rp-edit-email').value.trim();
    const phone = document.getElementById('rp-edit-phone').value.trim();

    try {
        const updated = { ...residentsData[currentResidentId], email, phone };
        await set(ref(db, `residents/${currentResidentId}`), updated);
        residentsData[currentResidentId] = updated;

        toggleProfileEdit(false);
        renderProfile();
        alert('Profile updated successfully!');
    } catch (error) {
        console.error('Error updating profile:', error);
        alert('Failed to update profile. Check your internet connection.');
    }
};

// ==========================================
// BOOTSTRAP: start live sync + restore session
// ==========================================
startRealtimeSync();
restoreSession();