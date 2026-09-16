import { deleteApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
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
  setDoc,
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
  if (stationScopedCollections.has(name)) {
    // Station users are always limited to their own station. Network users
    // may choose another station, but a missing value must never create an
    // unscoped record that other users cannot query.
    data.station = String(
      hasNetworkScope(profile) ? (data.station || profile.station || "JKT") : profile.station
    ).trim().toUpperCase();
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
gate.classList.add("is-checking-session");
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
    const isSuperadmin = window.FAC_AUTH_USER?.role === "superadmin";
    if (!isSuperadmin && location.hash === "#manage") {
      location.hash = "#dashboard";
      requestAnimationFrame(() => document.querySelector('.sidebar-inner nav a[href="#dashboard"]')?.click());
    }
    document.querySelectorAll(".sidebar-inner nav button, .sidebar-inner nav a").forEach(button => {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
      if (button.textContent.trim().includes("Portal Management")) {
        button.dataset.firebaseRole = window.FAC_AUTH_USER?.role || "";
        button.hidden = !isSuperadmin;
        button.style.setProperty("display", isSuperadmin ? "" : "none", "important");
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

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function installUserManagement() {
  if (window.FAC_AUTH_USER?.role !== "superadmin") return;

  const install = () => {
    const panels = [...document.querySelectorAll(".management-grid section")];
    const panel = panels.find(item => item.querySelector("h3")?.textContent.trim() === "User & Access Management");
    if (!panel || panel.dataset.firebaseUsers === "ready") return false;
    panel.dataset.firebaseUsers = "ready";
    panel.classList.add("fac-user-admin");
    panel.innerHTML = `
      <div class="fac-user-admin__heading">
        <div>
          <h3>User & Access Management</h3>
          <p>Create portal accounts and connect Authentication with Firestore automatically.</p>
        </div>
        <button type="button" class="fac-user-primary" data-action="show-create">+ Add account</button>
      </div>
      <form class="fac-user-form" hidden>
        <input name="editUid" type="hidden">
        <label>Employee name<input name="displayName" required autocomplete="off"></label>
        <label class="fac-user-email-field">Email<input name="email" type="email" required autocomplete="off"></label>
        <label class="fac-user-password-field">Temporary password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Role<select name="role" required>
          <option value="viewer">Viewer</option>
          <option value="member">FAC Member</option>
          <option value="coordinator">FAC Coordinator</option>
          <option value="admin">Admin</option>
          <option value="superadmin">Super Admin</option>
        </select></label>
        <label>Station<input name="station" required maxlength="5" placeholder="e.g. JKT, CGK, DPS" autocomplete="off"></label>
        <div class="fac-user-form__actions">
          <button type="button" class="fac-user-secondary" data-action="cancel-create">Cancel</button>
          <button type="submit" class="fac-user-primary">Create account</button>
        </div>
        <p class="fac-user-message" aria-live="polite"></p>
      </form>
      <div class="fac-user-table-wrap">
        <table class="fac-user-table">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Station</th><th>Status</th><th>Action</th></tr></thead>
          <tbody><tr><td colspan="6">Loading accounts…</td></tr></tbody>
        </table>
      </div>
      <p class="access-note">Passwords are never stored in Firestore. Reset password sends an official Firebase email to the account owner.</p>`;

    const form = panel.querySelector(".fac-user-form");
    const message = panel.querySelector(".fac-user-message");
    const tbody = panel.querySelector("tbody");
    const formSubmit = form.querySelector('[type="submit"]');

    const resetFormMode = () => {
      form.reset();
      form.elements.editUid.value = "";
      form.elements.email.disabled = false;
      form.elements.password.required = true;
      form.querySelector(".fac-user-password-field").hidden = false;
      formSubmit.textContent = "Create account";
    };

    const setMessage = (text, type = "") => {
      message.textContent = text;
      message.dataset.type = type;
    };

    const loadUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, "users"));
        const users = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
          .sort((left, right) => String(left.displayName || left.name || left.email).localeCompare(String(right.displayName || right.name || right.email)));
        tbody.innerHTML = users.length ? users.map(user => `
          <tr>
            <td>${escapeHTML(user.displayName || user.name || "—")}</td>
            <td>${escapeHTML(user.email || "—")}</td>
            <td>${escapeHTML(user.role || "viewer")}</td>
            <td>${escapeHTML(user.station || "—")}</td>
            <td><span class="fac-user-status ${user.active === false ? "is-inactive" : ""}">${user.active === false ? "Inactive" : "Active"}</span></td>
            <td><div class="fac-user-actions">
              <button type="button" class="fac-user-action" data-action="edit-user" data-uid="${escapeHTML(user.id)}">Edit</button>
              <button type="button" class="fac-user-action" data-action="toggle-user" data-uid="${escapeHTML(user.id)}" data-active="${user.active === false ? "false" : "true"}">${user.active === false ? "Activate" : "Deactivate"}</button>
              <button type="button" class="fac-user-action" data-action="reset-user" data-email="${escapeHTML(user.email || "")}">Reset</button>
              <button type="button" class="fac-user-action danger" data-action="delete-user" data-uid="${escapeHTML(user.id)}">Delete access</button>
            </div></td>
          </tr>`).join("") : `<tr><td colspan="6">No portal account profiles found.</td></tr>`;
      } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="6">Accounts could not be loaded. Check Firestore Rules.</td></tr>`;
      }
    };

    panel.querySelector('[data-action="show-create"]').addEventListener("click", () => {
      resetFormMode();
      form.hidden = false;
      form.querySelector('[name="displayName"]').focus();
    });
    panel.querySelector('[data-action="cancel-create"]').addEventListener("click", () => {
      resetFormMode();
      form.hidden = true;
      setMessage("");
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const values = new FormData(form);
      const editUid = String(form.elements.editUid.value || "");
      const displayName = String(values.get("displayName") || "").trim();
      const email = String(form.elements.email.value || "").trim().toLowerCase();
      const password = String(values.get("password") || "");
      const role = String(values.get("role") || "viewer").trim().toLowerCase();
      const station = String(values.get("station") || "").trim().toUpperCase();
      let secondaryApp;
      let createdUser;

      submit.disabled = true;
      setMessage(editUid ? "Saving account changes…" : "Creating Firebase account…");
      try {
        if (editUid) {
          await updateDoc(doc(db, "users", editUid), {
            displayName,
            name: displayName,
            role,
            station,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser.uid
          });
          resetFormMode();
          form.hidden = true;
          setMessage("");
          await loadUsers();
          alert(`Account profile ${email} updated.`);
          return;
        }
        secondaryApp = initializeApp(config, `fac-account-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        createdUser = credential.user;
        await setDoc(doc(db, "users", createdUser.uid), {
          uid: createdUser.uid,
          displayName,
          name: displayName,
          email,
          role,
          station,
          active: true,
          status: "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: auth.currentUser.uid
        });
        await signOut(secondaryAuth);
        await sendPasswordResetEmail(auth, email);
        resetFormMode();
        form.hidden = true;
        setMessage("");
        await loadUsers();
        alert(`Account ${email} created. Firebase password setup email has been sent.`);
      } catch (error) {
        console.error(error);
        if (createdUser) {
          try { await deleteUser(createdUser); } catch (rollbackError) { console.error(rollbackError); }
        }
        const knownMessages = {
          "auth/email-already-in-use": "Email is already registered in Firebase Authentication.",
          "auth/invalid-email": "Email format is invalid.",
          "auth/weak-password": "Temporary password must contain at least 8 characters.",
          "permission-denied": "Firestore rejected the profile. Confirm the current account role is exactly superadmin."
        };
        setMessage(knownMessages[error.code] || error.message || "Account could not be created.", "error");
      } finally {
        if (secondaryApp) {
          try { await deleteApp(secondaryApp); } catch (cleanupError) { console.error(cleanupError); }
        }
        submit.disabled = false;
      }
    });

    panel.addEventListener("click", async event => {
      const button = event.target.closest(".fac-user-action");
      if (!button) return;
      const action = button.dataset.action;
      const uid = button.dataset.uid;
      const email = button.dataset.email;
      button.disabled = true;
      try {
        if (action === "reset-user") {
          if (!email || !confirm(`Send password reset email to ${email}?`)) return;
          await sendPasswordResetEmail(auth, email);
          alert(`Password reset email sent to ${email}.`);
        } else if (action === "toggle-user") {
          if (uid === auth.currentUser.uid) return alert("The account currently in use cannot be deactivated.");
          const active = button.dataset.active !== "true";
          await updateDoc(doc(db, "users", uid), {
            active,
            status: active ? "active" : "inactive",
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser.uid
          });
          await loadUsers();
        } else if (action === "edit-user") {
          const snapshot = await getDoc(doc(db, "users", uid));
          if (!snapshot.exists()) throw new Error("Profile not found.");
          const current = snapshot.data();
          form.elements.editUid.value = uid;
          form.elements.displayName.value = current.displayName || current.name || "";
          form.elements.email.value = current.email || "";
          form.elements.email.disabled = true;
          form.elements.password.required = false;
          form.querySelector(".fac-user-password-field").hidden = true;
          form.elements.role.value = current.role || "viewer";
          form.elements.station.value = current.station || "";
          formSubmit.textContent = "Save changes";
          form.hidden = false;
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (action === "delete-user") {
          if (uid === auth.currentUser.uid) return alert("The account currently in use cannot be deleted.");
          if (!confirm("Delete this user's portal access? The Authentication record must be removed separately in Firebase Console.")) return;
          await deleteDoc(doc(db, "users", uid));
          await loadUsers();
        }
      } catch (error) {
        console.error(error);
        alert(error.message || "Account action could not be completed.");
      } finally {
        button.disabled = false;
      }
    });

    loadUsers();
    return true;
  };

  if (install()) return;
  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}

async function prepareNotificationPreferences(user) {
  const preferenceRef = doc(db, "userPreferences", user.uid);
  let readNotifications = [];
  try {
    const snapshot = await getDoc(preferenceRef);
    if (snapshot.exists() && Array.isArray(snapshot.data().readNotifications)) {
      readNotifications = snapshot.data().readNotifications.map(String);
    }
  } catch (error) {
    console.error("Notification preferences could not be loaded.", error);
  }
  window.FAC_READ_NOTIFICATIONS = readNotifications;
  window.FAC_NOTIFICATION_STORE = {
    async markRead(ids) {
      const next = [...new Set([...window.FAC_READ_NOTIFICATIONS, ...ids.map(String)])];
      window.FAC_READ_NOTIFICATIONS = next;
      await setDoc(preferenceRef, {
        readNotifications: next,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  };
}

async function revealPortal() {
  // Load the application only after Firebase has verified the user profile.
  // This guarantees that React receives the real role on its first render;
  // previously it could render with the temporary role and leave Portal
  // Management empty even for a Super Admin.
  showMessage("Menyiapkan portal sesuai kewenangan akun…");
  await import("/assets/index-D2PRUK_b.js");
  gate.remove();
  document.body.classList.remove("auth-pending");
  root.removeAttribute("aria-hidden");
  attachLogout();
  reinforcePortalNavigation();
  installUserManagement();
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    gate.classList.remove("is-checking-session");
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
    const normalizedRole = String(profile.role || "viewer")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    window.FAC_AUTH_USER = {
      uid: user.uid,
      email: user.email,
      displayName: profile.displayName || user.email,
      role: normalizedRole,
      station: String(profile.station || "").trim().toUpperCase()
    };
    await prepareNotificationPreferences(user);
    await revealPortal();
  } catch (error) {
    console.error(error);
    await signOut(auth);
    showMessage(error.message === "ACCOUNT_INACTIVE" ? "Akun ini sedang dinonaktifkan." : "Profil akun belum tersedia pada database users.", "error");
    submitButton.disabled = false;
  }
});
