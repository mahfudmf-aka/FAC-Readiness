import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const config = window.FAC_FIREBASE_CONFIG;
const root = document.querySelector("#root");

if (!config) {
  throw new Error("Firebase configuration is not available.");
}

const firebaseApp = initializeApp(config);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const collectionNames = {
  members: "facMembers",
  equipment: "equipment",
  training: "trainings",
  templates: "checklistTemplates",
  submissions: "checklistRecords",
  config: "settings",
  rooms: "facRooms",
  partnerships: "partnerships"
};

const stationScopedCollections = new Set([
  "facMembers",
  "equipment",
  "trainings",
  "checklistRecords",
  "facRooms",
  "partnerships"
]);

function currentProfile() {
  if (!auth.currentUser || !window.FAC_AUTH_USER) {
    throw new Error("Sesi pengguna belum siap. Silakan login kembali.");
  }
  return window.FAC_AUTH_USER;
}

async function waitForProfile() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (auth.currentUser && window.FAC_AUTH_USER) return window.FAC_AUTH_USER;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return currentProfile();
}

function hasNetworkScope(profile) {
  return profile.role === "superadmin" || String(profile.station || "").toUpperCase() === "JKT";
}

function onlineCollection(key) {
  const name = collectionNames[key];
  if (!name) throw new Error(`Collection ${key} belum terdaftar.`);
  return name;
}

function cleanData(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}

function scopedData(name, value, profile) {
  const data = cleanData(value);
  if (stationScopedCollections.has(name) && !hasNetworkScope(profile)) {
    data.station = String(profile.station || "").toUpperCase();
  } else if (data.station) {
    data.station = String(data.station).toUpperCase();
  }
  return data;
}

async function writeAudit(action, collectionName, recordId) {
  const profile = await waitForProfile();
  await addDoc(collection(db, "auditLogs"), {
    action,
    collection: collectionName,
    recordId: String(recordId),
    station: String(profile.station || "").toUpperCase(),
    userId: profile.uid,
    userEmail: profile.email || "",
    createdAt: serverTimestamp()
  });
}

window.FAC_DB = {
  async list(key) {
    const profile = await waitForProfile();
    const name = onlineCollection(key);
    let source = collection(db, name);
    if (stationScopedCollections.has(name) && !hasNetworkScope(profile)) {
      source = query(source, where("station", "==", String(profile.station || "").toUpperCase()));
    }
    const snapshot = await getDocs(source);
    return snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
  },

  async add(key, value) {
    const profile = await waitForProfile();
    const name = onlineCollection(key);
    const data = scopedData(name, value, profile);
    const reference = await addDoc(collection(db, name), {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: profile.uid,
      updatedAt: serverTimestamp(),
      updatedBy: profile.uid
    });
    await writeAudit("create", name, reference.id).catch(console.error);
    return { ...data, id: reference.id };
  },

  async addMany(key, values) {
    const profile = await waitForProfile();
    const name = onlineCollection(key);
    const results = [];
    for (let offset = 0; offset < values.length; offset += 400) {
      const batch = writeBatch(db);
      const chunk = values.slice(offset, offset + 400);
      for (const value of chunk) {
        const reference = doc(collection(db, name));
        const data = scopedData(name, value, profile);
        batch.set(reference, {
          ...data,
          createdAt: serverTimestamp(),
          createdBy: profile.uid,
          updatedAt: serverTimestamp(),
          updatedBy: profile.uid
        });
        results.push({ ...data, id: reference.id });
      }
      await batch.commit();
    }
    await writeAudit("import", name, `${results.length}-records`).catch(console.error);
    return results;
  },

  async update(key, recordId, value) {
    const profile = await waitForProfile();
    const name = onlineCollection(key);
    const data = scopedData(name, value, profile);
    await updateDoc(doc(db, name, String(recordId)), {
      ...data,
      updatedAt: serverTimestamp(),
      updatedBy: profile.uid
    });
    await writeAudit("update", name, recordId).catch(console.error);
    return { ...data, id: String(recordId) };
  },

  async remove(key, recordId) {
    const name = onlineCollection(key);
    await deleteDoc(doc(db, name, String(recordId)));
    await writeAudit("delete", name, recordId).catch(console.error);
  }
};

function createGate() {
  const gate = document.createElement("section");
  gate.id = "fac-auth-gate";
  gate.innerHTML = `
    <div class="fac-auth-visual">
      <div class="fac-auth-brand">
        <img src="/assets/fac-logo.png" alt="FAC logo">
        <div><strong>GARUDA INDONESIA</strong><span>Family Assistance Center</span></div>
      </div>
      <div class="fac-auth-copy">
        <span class="fac-auth-kicker">FAC Readiness Portal</span>
        <h1>Prepared to care,<br>ready to respond.</h1>
        <p>Portal terintegrasi untuk memantau kesiapan anggota, fasilitas, pelatihan, checklist, dan kolaborasi FAC.</p>
      </div>
      <div class="fac-auth-foot">Internal operational portal · Authorized access only</div>
    </div>
    <div class="fac-auth-form-side">
      <form class="fac-auth-card" id="facLoginForm">
        <h2>Selamat datang</h2>
        <p class="fac-auth-intro">Masuk menggunakan akun yang telah didaftarkan oleh Super Admin.</p>
        <label class="fac-auth-field">Email
          <input id="facLoginEmail" type="email" autocomplete="username" placeholder="nama@email.com" required>
        </label>
        <label class="fac-auth-field">Password
          <input id="facLoginPassword" type="password" autocomplete="current-password" placeholder="Masukkan password" required>
        </label>
        <div class="fac-auth-row"><button type="button" class="fac-auth-link" id="facResetPassword">Lupa password?</button></div>
        <button class="fac-auth-submit" id="facLoginButton" type="submit">Masuk ke Portal</button>
        <p class="fac-auth-message" id="facAuthMessage" aria-live="polite">Koneksi aman dengan Firebase Authentication.</p>
        <div class="fac-auth-security"><span>●</span><span>Dashboard hanya ditampilkan setelah akun dan role pengguna berhasil diverifikasi.</span></div>
      </form>
    </div>`;
  document.body.appendChild(gate);
  return gate;
}

const gate = createGate();
const form = gate.querySelector("#facLoginForm");
const emailInput = gate.querySelector("#facLoginEmail");
const passwordInput = gate.querySelector("#facLoginPassword");
const submitButton = gate.querySelector("#facLoginButton");
const message = gate.querySelector("#facAuthMessage");

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `fac-auth-message ${type}`.trim();
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email atau password tidak sesuai.";
  if (code.includes("too-many-requests")) return "Percobaan login terlalu banyak. Tunggu beberapa saat lalu coba kembali.";
  if (code.includes("network-request-failed")) return "Koneksi internet bermasalah. Periksa jaringan lalu coba kembali.";
  if (code.includes("unauthorized-domain")) return "Domain Netlify ini belum terdaftar pada Authorized domains Firebase.";
  return "Login belum berhasil. Periksa email, password, dan konfigurasi Firebase.";
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  showMessage("Memverifikasi akun…");
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
  } catch (error) {
    console.error(error);
    showMessage(friendlyAuthError(error), "error");
    submitButton.disabled = false;
  }
});

gate.querySelector("#facResetPassword").addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    emailInput.focus();
    showMessage("Isi alamat email terlebih dahulu.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Tautan penggantian password telah dikirim ke email tersebut.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Permintaan reset password belum berhasil.", "error");
  }
});

function attachLogout() {
  const placeButton = () => {
    const profile = document.querySelector(".profile");
    if (!profile || profile.querySelector(".fac-firebase-logout")) return false;
    const user = window.FAC_AUTH_USER || {};
    const displayName = user.displayName || user.email || "User";
    const words = displayName.trim().split(/\s+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : displayName.slice(0, 2)).toUpperCase();
    const roleLabels = { superadmin: "Super Admin", admin: "Admin", coordinator: "FAC Coordinator", member: "FAC Member", viewer: "Viewer" };
    const avatar = profile.querySelector(".avatar");
    const identity = profile.children[1];
    if (avatar) avatar.textContent = initials;
    if (identity) {
      const name = identity.querySelector("strong");
      const role = identity.querySelector("span");
      if (name) name.textContent = displayName;
      if (role) role.textContent = roleLabels[user.role] || "Authorized User";
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fac-firebase-logout";
    button.textContent = "Logout";
    button.addEventListener("click", () => signOut(auth));
    profile.appendChild(button);
    return true;
  };
  if (placeButton()) return;
  const observer = new MutationObserver(() => {
    if (placeButton()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}

function reinforcePortalNavigation() {
  const apply = () => {
    document.querySelectorAll(".sidebar-inner nav button").forEach(button => {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
      if (button.textContent.trim().includes("Portal Management")) {
        const isSuperadmin = window.FAC_AUTH_USER?.role === "superadmin";
        button.dataset.firebaseRole = window.FAC_AUTH_USER?.role || "";
        button.hidden = !isSuperadmin;
        button.style.display = isSuperadmin ? "" : "none";
        button.title = isSuperadmin ? "Open Portal Management" : "";
        if (!button.dataset.portalScrollFix) {
          button.dataset.portalScrollFix = "true";
          button.addEventListener("click", () => {
            // The dashboard uses an independently scrolling main column. When a
            // long page was open previously, keeping that scroll position can
            // make Portal Management look blank even though it has rendered.
            requestAnimationFrame(() => {
              window.scrollTo({ top: 0, left: 0 });
              document.querySelector(".main")?.scrollTo?.({ top: 0, left: 0 });
              document.querySelector(".content")?.scrollIntoView?.({ block: "start" });
            });
          });
        }
      }
    });
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}

function revealPortal() {
  gate.remove();
  document.body.classList.remove("auth-pending");
  root.removeAttribute("aria-hidden");
  attachLogout();
  reinforcePortalNavigation();
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    document.body.classList.add("auth-pending");
    root.setAttribute("aria-hidden", "true");
    if (!document.body.contains(gate)) location.reload();
    submitButton.disabled = false;
    return;
  }

  showMessage("Memuat profil dan kewenangan pengguna…");
  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!profileSnapshot.exists()) throw new Error("PROFILE_NOT_FOUND");
    const profile = profileSnapshot.data();
    if (profile.active === false) throw new Error("ACCOUNT_INACTIVE");
    window.FAC_AUTH_USER = {
      uid: user.uid,
      email: user.email,
      displayName: profile.displayName || user.email,
      role: profile.role || "viewer",
      station: profile.station || ""
    };
    revealPortal();
  } catch (error) {
    console.error(error);
    await signOut(auth);
    showMessage(error.message === "ACCOUNT_INACTIVE" ? "Akun ini sedang dinonaktifkan." : "Profil akun belum tersedia pada database users.", "error");
    submitButton.disabled = false;
  }
});
