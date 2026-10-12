# MAXOUT Command Center

Private staff dashboard for MAXOUT. Username/password logins and database-enforced role permissions.

## Deployment
1. Connect this repository to Vercel as a Next.js app.
2. Provision a PostgreSQL database (e.g. Neon) and set `DATABASE_URL`.
3. Set `SESSION_SECRET` to a random value of at least 32 characters.
4. Set `OWNER_PASSWORD` to the requested owner password and `STAFF_INITIAL_PASSWORD` to the requested starter staff password in **Vercel Environment Variables, not GitHub**. These are only used on first initialization, before any owner exists. Change the shared starter passwords through the Owner Users page.
5. (Optional) Connect Vercel Blob and add `BLOB_READ_WRITE_TOKEN` to allow designers to upload files.
6. Deploy. The tables and initial users are created on first request. The initially provisioned usernames are `NoahAlter`, `Marketing`, `Accounting`, `Designer`.

## Security
Passwords are stored only as bcrypt hashes; sessions use signed HttpOnly cookies. API role checks apply to both reading and editing. All money shown is manually tracked, not a live bank integration. Username/passwords cannot be retrieved; owners may reset passwords. The 3 starter team accounts initially share a password: change them before real use.

## Workbook
Owner can import data from the supplied **MAXOUT Command Center .xlsx** through the Import Workbook action. The Products, Sales Tracker, Expenses, Marketing, Inventory and Monthly Budget sheets are recognized. Workbook data is added to the database; imports can create duplicate rows if repeated. The import is reviewed in the browser before submission and doesn't sync changes back to Google Sheets.

## Notes
This is an internal operational system, separate from maxoutshop.com. Social media links are shortcuts, not authenticated analytics connections. Owner edits the bank balance, not a real bank.