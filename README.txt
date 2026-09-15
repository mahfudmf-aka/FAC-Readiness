FAC READINESS PORTAL — NETLIFY UI + FIREBASE LOGIN

This package uses the latest FAC portal visual baseline, not the older offline
demo design. Upload the ZIP directly to Netlify Deploys, or extract it and
upload all files in the folder. index.html must remain at the top level.

FAC member data, the original Excel workbook, FAC logo, favicon and map assets
are bundled in /assets.

Firebase Authentication gate is active. The portal stays hidden until the
email/password account is authenticated and its matching User UID is found in
the Firestore collection users. Inactive accounts are rejected.

DEPLOY & TEST
1. Upload this ZIP to the existing Netlify site through Deploys.
2. Keep preeminent-pastelito-6825d9.netlify.app in Firebase Authentication >
   Settings > Authorized domains.
3. Sign in with the Firebase email/password account already created.
4. Use Logout in the profile section to return to the login page.

This revision adds only the login gate. Current operational records remain in
browser demo storage until each module is migrated to Firestore in stages.

PORTAL MANAGEMENT
The Portal Management page is available only for a Firestore profile whose
role is "superadmin". This revision also resets the dashboard scroll position
when that menu is opened so the page does not appear blank after viewing a long
table. To add a login account, create the email/password user in Firebase
Authentication first, then create users/{UID} in Firestore with displayName,
role, station and active fields. Creating Authentication users directly from a
browser admin page is intentionally avoided because it would expose privileged
account-creation access to the client.

ROLE AND STATION ACCESS
- superadmin: Portal Management is visible and all management permissions apply.
- admin: Portal Management is hidden; operational data can still be managed.
- station JKT: all FAC member stations are visible.
- stations other than JKT: only FAC members from the user's own station are
  shown, exported, added, edited, or imported.

FIRESTORE ONLINE DATA — STAGE 1
The portal now uses Cloud Firestore instead of browser localStorage for member
changes, equipment, training, checklist templates, checklist submissions, and
Portal Management settings. Each online write records created/updated metadata,
and create/update/delete/import activity is recorded in auditLogs.

The bundled member Excel remains the initial baseline. New entries, edits,
deletions, and imports made after this version is deployed are stored online.
Existing data that was previously saved only in one browser is not copied
automatically.

Before production use, publish the included firestore.rules in Firebase Console
so the role and station boundaries are enforced by Firebase, not only by the
screen.
