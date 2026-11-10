# jk-inventario

JK Innovations inventory and orders system: stock by school, size and color, low-stock alerts, multi-line orders with CA tax, and CSV/JSON export. Built on Supabase with secure login.

Workshop inventory for Norma Muñoz (Fase 0 + Fase 1). The screen is English by default. EN | ES switches it to Spanish and remembers the choice in this browser (`jkin-inv-lang`).

This repository is the inventory app. `index.html` is at the repository root so GitHub Pages can later serve it at `https://jk-innovations.github.io/jk-inventario/`. Do not turn Pages on until the Supabase project below is filled in and you mean to publish.

The app does not ship with a Supabase project. `js/config.js` has placeholders. Until those are replaced, the page loads and shows **Supabase is not configured**. It does not call Supabase.

## What this is

A static app for the whole workshop: products and SKUs, a stock ledger, and multi-line orders. Sign-in is Supabase Auth. There is no service-role key, secret key, or database password in the frontend. Row Level Security in schema `inventory` is what grants access.

### Why schema `inventory`

All inventory tables, views, and functions live in the schema **`inventory`**. Nothing in this migration creates or alters `public`. A table prefix such as `inv_` was the other option; the schema keeps the names readable (`inventory.variants` instead of `public.inv_variants`) and lets Row Level Security cover one bounded set of objects.

PostgREST does not expose a schema until it is added in the project settings. That step is required below.

## Connect Norma’s Supabase project

Create a **new** Supabase project for JK Innovations. Do not point this app at anyone else’s project.

### 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) with the JK Innovations account.
2. New project. Pick a name, a strong database password, and a region. Save the database password in a password manager. It does not go in this repo.
3. Wait until the project is ready. Note the project ref (the 20-character id in the project URL).

### 2. Put only the publishable key in `js/config.js`

Dashboard → **Project Settings → API Keys** (some projects still label this **API**).

| Copy this | Into |
| --- | --- |
| Project URL, shaped like `https://<project-ref>.supabase.co` | `SUPABASE_URL` |
| **Publishable** key, also labeled **anon** / **anon public**. It starts with `sb_publishable_` or is a long `eyJ…` JWT whose role is `anon` | `SUPABASE_ANON_KEY` |

Leave `SCHEMA` as `"inventory"`. Leave `TAX_RATE` as `0.1075` (CA tax 10.75%). The database function `inventory.prepare_order()` uses the same rate.

Do **not** paste:

- the **secret** key (`sb_secret_…`)
- the **service_role** key
- the database password
- the JWT secret

Commit the file only if the value you added is the publishable anon key. That key is public by design; RLS still blocks workshop data. Never commit a secret.

Until both placeholders (`YOUR_PROJECT_REF` and `YOUR_PUBLISHABLE_ANON_KEY`) are replaced with a real project URL and a publishable key, the app stays on the not-configured screen.

### 3. Apply the schema

In the Supabase **SQL Editor**, as the database owner:

1. Open `supabase/001_inventory_schema.sql`, paste it, and run it. The workshop stays empty. Re-running the file is safe.
2. Dashboard → **Project Settings → Data API** (some projects still label this **API**) → **Exposed schemas**. Add `inventory` and keep `public`. Save.
3. If the app later says the schema is missing, run `notify pgrst, 'reload schema';` once. The migration already sends that notify at the end.

### 4. First admin

1. Authentication → add the person (email and password), or have them open the app and use “Email a reset link” after the user exists.
2. Edit the email in `supabase/grant_admin.example.sql` and run that file **once** in the SQL editor. The file refuses to run while `REPLACE_WITH_USER_EMAIL` is still there.
3. Further people can be granted in the app. They sign in, copy the user id from the no-access screen, and an admin pastes it under Directory → People.

A signed-in user with no row in `inventory.profiles` sees only their user id. They cannot read workshop data. The app cannot grant its own first role.

### 5. Auth URLs for password reset

Authentication → **URL configuration**:

- Site URL for local use: `http://127.0.0.1:4173/`
- Add that origin to the redirect allow list.
- When GitHub Pages is turned on later, also allow `https://jk-innovations.github.io/jk-inventario/`.

### 6. Optional demo seed

`supabase/002_seed_demo.sql` inserts a fictional school, three products (uniform, sports, and a general beanie), movements, and one confirmed multi-line order. It does not create logins. **Do not run it** if this database is about to hold a real count. Running it twice does not duplicate the sample rows.

After the demo seed, navy youth M is in stock (physical 12, reserved 2, available 10), navy adult M is low (2, minimum 3), and maroon YXS is out. The sample order total is $64.24 = $58.00 client subtotal + $6.24 tax. Cost on that polo is $8.50 and is not part of the total.

## Roles

| | Admin | Inventario | Producción |
| --- | --- | --- | --- |
| See catalog, stock, movements, orders | yes | yes | yes |
| Schools, clients, products, SKUs, orders | write | write | no |
| Delete schools, clients, products, SKUs | yes | no | no |
| Delete a draft or cancelled order | yes | yes | no |
| Record a movement (receive, adjust, count, return, correction) | yes | yes | yes |
| Insert a `fulfill` movement by hand | no | no | no |
| Change order status, including Fulfill | yes | yes | no |
| Grant or change roles | yes | no | no |

`fulfill` rows are written only by the database when an order status becomes `fulfilled`. Adjust and correction require a note. There is no update policy on movements: a mistake is a new row, not a silent edit.

At least one active admin must remain.

## Stock and money

- **Physical** is the sum of movement deltas.
- **Reserved** is the sum of line quantities on orders in `confirmed`, `in_production`, or `ready`.
- **Available** = physical − reserved.
- **In stock** means available is above the minimum. **Low** means available is above 0 and at or below the minimum. **Out** means available is 0 or less.
- Minimum defaults to **3** on each SKU and can be edited per SKU.
- **Cost** and **client price** are different columns. Order subtotal, tax, and total use the client price only. Cost is never copied onto an order line.
- CA tax is **10.75%** of the client subtotal, rounded half away from zero to the cent.

Order status hook for later phases (not built here):

`draft` does not reserve. `confirmed` → `in_production` → `ready` reserve stock and do not deduct it. Entering `fulfilled` posts one negative movement per line (`reason = fulfill`) and releases the reserve. `fulfilled` and `cancelled` are final. A return is a new movement with reason `return`. Delivery method and tracking are Fase 2 and are not columns yet. `orders.reference` is a free-text note for a future online id; nothing is synced to WooCommerce.

Channels: workshop, school, online, other. Online does not sync.

Youth and adult are separate size groups. Sports is a product category, not a size group.

## Screens

- Not configured, when `js/config.js` still has placeholders.
- Login, and a no-access screen that shows the user id to grant.
- Dashboard: in stock / low / out, available units, needs-attention list, reorder grouped by supplier, quick entry (`5 polo navy M`), CSV and JSON export, buttons to add a school, client, or product.
- Products: supplier, product number, garment, category, lead time, and SKUs with color, size, cost, client price, minimum, school, client, and design.
- Movements: a reason is required. Count sets a physical total and stores the difference.
- Orders: several lines, name on the garment, slide, sign, subtotal, CA tax, total.
- Directory for schools, clients, and (admin) people.

Quick entry runs in the browser. It does not call an AI. Receive is a `receive` movement. Deduct is an `adjust` and needs a note. Adjust is a `correction` and needs a note and an explicit delta.

## Run it locally

From the repository root:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`.

Use a local server. Opening `index.html` as a file will not load the modules. With the placeholder config, the page shows **Supabase is not configured** and does not crash.

There is no build step. Checks that do not touch Supabase:

```bash
node --test test/logic.test.js
```

`test/run-sql.sh` builds a throwaway local database named `jkin_inv_test` and checks stock math, tax, the ledger, and RLS. It needs PostgreSQL on the machine. It does not connect to the hosted project.

## GitHub Pages

Do not enable GitHub Pages as part of adding this app. When you later choose to publish `main` from the repository root (`/`), the app will be at:

`https://jk-innovations.github.io/jk-inventario/`

Fill in `js/config.js` and apply the SQL before you do that. The publishable anon key in that file will be visible to anyone who can load the page, which is expected. The secret key must stay out of the repo.

## Out of scope here

- WooCommerce sync and Woo PDF import (Fase 3).
- Delivery method, mail versus pickup, and required tracking (Fase 2). The fulfill status is the hook those rules can gate later.
- Email alerts, a full supplier admin, and the four PDF reports (Fase 4). Supplier is a text field plus lead time in days.
- Systeme.io iframe embedding.

## Layout

```
index.html          login and the app shell (repository root)
css/app.css         JK colors (terracotta, deep blue, paper)
js/config.js        SUPABASE_URL and SUPABASE_ANON_KEY placeholders
js/                 screens, quick entry, tax, CSV/JSON
supabase/           001 schema, optional 002 demo, admin example
test/               parser, tax, render checks, local SQL checks
```

The browser Supabase client in `js/vendor/supabase.js` is vendored so this folder can be opened on its own. It is the client library, not a project key.
