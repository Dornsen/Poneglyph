# Poneglyph (USOF)

Poneglyph is a Reddit-style question and answer platform for programmers: a forum of forums.
Users create **communities**, communities have owners and moderators, posts live inside communities and
are organised by **local categories**, while communities themselves are grouped by **global categories**.

This repository currently contains the backend API (`Poneglyph-Backend`). The frontend is built after the API is finished and tested.

## Features

- Registration with email verification, login, logout, password reset by email, password change
- Roles: site `USER` / `MODERATOR` / `ADMIN`; community `OWNER` / `MODERATOR` / `MEMBER`
- Communities: create, join, leave, members list, moderators, ownership transfer, avatar
- Global categories (admins) attached to communities; local categories (community staff) attached to posts.
  Every community gets a default **General** category, so a post always has a category
- Posts with images and videos, drafts, moderation (activate / deactivate)
- Nested comments with media, comment locking
- Likes and dislikes on posts and comments, automatic score and user rating
- Post sorting (by likes by default, by date) and filtering (categories, date interval, status, text search, author), pagination
- Global feed and a personal feed of joined communities
- **Reports** on posts, comments and users, handled in a moderation queue (hide, delete, ban, suspend)
- **Community moderation panel** for owners and moderators: overview, reports, bans (temporary or permanent), requests for local categories, activity log
- **Site admin panel** (`/admin`): admins see everything, site moderators a cut-down version (no emails, no deleting, no account suspension)
- **Requests for new categories**: members ask for local categories, community staff ask for global ones; staff and admins decide
- Sorting on every list (`sort` and `order` query parameters)
- Demo data seed, automated tests

## Stack

Node.js 20+, Express 5, Prisma 6, PostgreSQL, JWT, bcrypt, multer, nodemailer.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- An SMTP account for the verification and password reset emails (any provider, e.g. a Gmail app password)

## Getting started

Everything you need after cloning the repository, step by step.

### 1. Install the tools

Node.js 20+ (`node -v`), PostgreSQL 14+ running locally and `npm`.

### 2. Create an empty PostgreSQL database

```bash
psql -U postgres -c "CREATE DATABASE usof_db;"
```

(or create it in pgAdmin). The tables are created by the migrations, not by hand.

### 3. Install dependencies

```bash
cd Poneglyph-Backend
npm install
```

`npm install` also generates the Prisma client.

### 4. Configure the environment

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Open `.env` and set at least:

| Variable | What to put |
| --- | --- |
| `DATABASE_URL` | Your PostgreSQL connection string (user, password, host, database `usof_db`) |
| `JWT_SECRET` | Any long random string. The server refuses to start without it |
| `SMTP_*` | A real mail account (for Gmail: an app password). Needed to send verification and password reset emails |

Everything else has a sensible default (see the comments in `.env.example`).
`CORS_ORIGINS` and `FRONTEND_URL` matter once the frontend exists.

> Without SMTP the demo accounts from the seed still work (they are already verified),
> but registering a new account and resetting a password will fail while sending the email.

### 5. Create the tables and the demo data

Pick one:

```bash
npm run db:reset            # recommended on a fresh database: applies all migrations AND runs the seed
```

or

```bash
npm run db:migrate          # only creates the tables
npm run seed                # fills an empty database with demo data (skipped if users already exist)
```

### 6. Run the server

```bash
npm run dev                 # http://localhost:5000 (restarts on changes); use npm start for production
```

Check it: open `http://localhost:5000/api/ping`.

### 7. Try it

- **Admin panel:** `http://localhost:5000/admin/`. Log in as `admin`.
- **API:** see [API overview](#api-overview) below or `Poneglyph-API-Documentation.pdf`.
- **Uploaded files** are stored in `Poneglyph-Backend/src/storage` and served from `/storage`.

Seeded accounts (all use the password from `SEED_PASSWORD`, default `Password123!`):

| Login | Role |
| --- | --- |
| `admin` | Site administrator |
| `sam` | Site moderator |
| `alice` | Owner of the first community |
| `bob`, `carol`, `dave`, `erin` | Regular users, some with community roles |
| `troll`, `spammer` | Users with bans and reports (for moderation demos) |

### 8. Run the tests (optional)

See [Tests](#tests) below: it needs a second, separate database.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `JWT_SECRET is required` on start | Set `JWT_SECRET` in `.env` |
| `Can't reach database server` | PostgreSQL is not running, or `DATABASE_URL` is wrong |
| `database "usof_db" does not exist` | Do step 2 |
| `The table ... does not exist` | Run `npm run db:migrate` (or `db:reset`) |
| 429 Too Many Requests on login | Rate limit: 10 login attempts per 15 minutes, wait or restart the server |
| Verification email never arrives | Check the `SMTP_*` values; for Gmail use an app password |
| Port 5000 is busy | Change `PORT` in `.env` |

### Scripts

| Script | What it does |
| --- | --- |
| `npm start` / `npm run dev` | Run the API (`dev` restarts on changes) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | Recreate the database and seed it (destroys all data) |
| `npm run seed` | Fill an empty database with demo data |
| `npm test` | Run the automated tests against the separate test database |

### Tests

Tests use their own database, so the development data is never touched. Create an empty database `usof_test`
(`psql -U postgres -c "CREATE DATABASE usof_test;"`) and the file `Poneglyph-Backend/.env.test`:

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/usof_test?schema=public"
JWT_SECRET=any_string_for_tests
NODE_ENV=test
```

`npm test` applies the migrations to that database and runs the suite. The runner refuses to start unless the database name contains `test`.
Emails are captured by a fake mailer, so no SMTP server is needed.

## Screenshots

The seeded demo data, shown in the web admin panel (`/admin`) and in an API response.

**Site dashboard** (admin): counters, biggest communities and the latest moderation actions.

![Site dashboard](screenshots/admin-dashboard.png)

**Reports queue**: complaints from every community, with filters, sorting and resolve / dismiss actions.

![Reports queue](screenshots/admin-reports.png)

**Users**: accounts, roles and suspensions.

![Users](screenshots/admin-users.png)

**Activity log**: what moderators and admins did.

![Activity log](screenshots/admin-activity-log.png)

**Community panel**: overview and bans of a single community, available to its owner and moderators.

![Community overview](screenshots/community-overview.png)

![Community bans](screenshots/community-bans.png)

**API**: `GET /api/posts?limit=1&sort=likes` returns a page of posts with author, community, categories, media and pagination meta.

![API response](screenshots/api-posts.png)

## Architecture

```
src/
  server.js          process entry point: reads the config, creates the app, listens
  app.js             builds the Express app from injected dependencies
  container.js       composition root: wires services, controllers and middlewares
  config/            environment config, Prisma client, SMTP mailer
  routes/            URL -> controller method (one router per module)
  controllers/       thin HTTP layer: parse params, call a service, send the response
  services/          business logic (Auth, User, Community, Category, Post, Comment, Reaction, Rating, Access, FileStorage)
  middlewares/       authentication, rate limits, uploads, error handling
  utils/             errors, id parsing, validators
prisma/              schema, migrations, seed
tests/               integration tests (node:test + supertest)
```

- **MVC with a service layer.** Controllers contain no business logic; services own the rules and talk to Prisma.
- **Dependency injection.** Services receive their collaborators in the constructor (`PrismaClient`, `Mailer`, other services),
  which is what lets the tests run the real application against a test database with a fake mailer.
- **One error path.** Services throw typed errors (`BadRequestError`, `ForbiddenError`, ...); a single error handler turns them into
  `{ "message": "..." }` responses and removes files uploaded for a failed request.
- **Stateless sessions with logout.** The JWT carries `token_version`; logout and password changes bump it, which invalidates every issued token.
  Role changes and account deletion invalidate tokens too.
- **Denormalised scores.** `posts.score` and `comments.score` (likes minus dislikes) are kept in sync by `RatingService`,
  which also recalculates `users.rating` (sum of the scores of the user's posts and comments). This makes "sort by likes" a plain indexed `ORDER BY`.

## Visibility and moderation rules

| Content status | Who sees it |
| --- | --- |
| `ACTIVE` | everyone |
| `INACTIVE` (hidden by moderation) | the author, community owner and moderators, admins |
| `DRAFT` / `ARCHIVED` (posts) | the author (`ARCHIVED` also staff) |

- A hidden post or comment looks exactly like a missing one (404) to everybody who may not see it. Replies under a hidden comment are hidden with it.
- Only the author can edit the content of a post or comment. Admins and moderators can only moderate: switch a post or comment between active and inactive,
  and move a post to other categories. An author cannot reactivate something a moderator deactivated.
- **Site moderators** (`MODERATOR` role) may hide and restore any content and handle reports, but cannot delete content, manage communities,
  see emails, suspend accounts or decide about global categories. Admins can do all of it.
- A user **banned** from a community is removed from it and cannot join, post or comment there until the ban ends or is lifted.
- A **suspended** account cannot sign in and its tokens stop working at once.
- Comments and reactions are accepted only under active posts / active comments.
- Posting requires community membership. Commenting and reacting requires only an account.

## API overview

All errors look like `{ "message": "Human readable explanation" }`. Protected routes expect `Authorization: Bearer <token>`.
List endpoints return `{ "meta": { "total", "page", "limit", "totalPages" }, "data": [...] }`.
`optional` means the route works anonymously and shows more to a signed in viewer.

### Auth: `/api/auth`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/register` | `login, email, full_name, password, password_confirmation`; sends a verification email |
| GET | `/verify?token=` | confirms the email |
| POST | `/resend-verification` | `email`; always answers the same way |
| POST | `/login` | `login` (login or email) and `password`; returns `token` and `user` |
| POST | `/logout` | auth; invalidates all tokens of the user |
| POST | `/reset-password-request` | `email`; always answers the same way |
| POST | `/reset-password` | `token, password` (token comes from the email) |
| POST | `/change-password` | auth; `current_password, new_password, new_password_confirmation`; returns a fresh token |

### Users: `/api/users`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | optional; `page, limit, search`; admins also see emails |
| POST | `/` | admin; creates a verified user with a role |
| PATCH | `/avatar` | auth; multipart field `avatar` |
| GET | `/:user_id` | optional; email only for the owner and admins |
| GET | `/:user_id/communities` | communities of the user with their role |
| PATCH | `/:user_id` | owner or admin; `login, email, full_name`, and `role` for admins |
| DELETE | `/:user_id` | owner or admin; blocked while the user owns communities |

### Communities: `/api/communities`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | optional; `page, limit, search`; includes `viewer_role` |
| POST | `/` | auth; `title, description, global_category_ids`; creates the General category |
| GET / PATCH / DELETE | `/:community_id` | PATCH: staff; DELETE: owner or admin |
| PATCH | `/:community_id/avatar` | staff; multipart field `avatar` |
| POST / DELETE | `/:community_id/join`, `/leave` | auth |
| GET | `/:community_id/members` | `page, limit, role` |
| PATCH / DELETE | `/:community_id/members/:user_id` | PATCH `{ role: MODERATOR \| MEMBER }`: owner or admin; DELETE (remove member): staff |
| POST | `/:community_id/transfer-ownership` | owner or admin; `{ user_id }` |
| PUT | `/:community_id/global-categories` | owner or admin; `{ global_category_ids: [...] }` replaces the set |

### Categories

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/global-categories`, `/:global_category_id` | public |
| GET | `/api/global-categories/:global_category_id/communities` | communities in the category |
| POST / PATCH / DELETE | `/api/global-categories[/:global_category_id]` | admin |
| GET | `/api/communities/:community_id/categories[/:category_id]` | public |
| POST / PATCH / DELETE | `/api/communities/:community_id/categories[/:category_id]` | staff; the default category cannot be deleted |
| GET | `/api/communities/:community_id/categories/:category_id/posts` | optional |

### Posts

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/posts` | optional; posts of all communities |
| GET | `/api/posts/feed` | auth; posts of the communities the user joined |
| GET | `/api/communities/:community_id/posts` | optional |
| POST | `/api/communities/:community_id/posts` | member; multipart or JSON: `title, content, categories, status (ACTIVE\|DRAFT)`, files in `media` (up to 8) |
| GET / PATCH / DELETE | `/api/communities/:community_id/posts/:post_id` | PATCH: author (content) or staff (status); DELETE: author or staff; PATCH also takes `removed_media_ids` |
| GET | `.../posts/:post_id/categories` | categories of the post |
| GET | `.../posts/:post_id/likes` | likes, dislikes and score |
| POST / DELETE | `.../posts/:post_id/like` | auth; `{ type: LIKE \| DISLIKE }`, one reaction per user |

List query parameters: `page, limit` (max 100), `sort=likes|date|comments|title` (default `likes`), `order=asc|desc`,
`categories=1,2`, `date_from`, `date_to` (ISO dates), `status`, `author_id`, `search`.

Other lists are sortable too: users (`rating|date|login|name`), communities (`members|posts|date|title`), community members (`joined|login|rating`),
global categories (`title|communities`), local categories (`title|posts`, the default category always first), comments (`likes|date`).

### Comments: `/api/communities/:community_id/posts/:post_id/comments`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | optional; replies come nested in `replies`; `sort=likes\|date`, `page`, `limit` apply to top level comments |
| POST | `/` | auth; `content`, optional `parent_id`, files in `media` (up to 5) |
| GET / PATCH / DELETE | `/:comment_id` | PATCH `content`: author; PATCH `status` (ACTIVE or INACTIVE): staff; DELETE: author or staff |
| GET | `/:comment_id/likes` | likes, dislikes and score |
| POST / DELETE | `/:comment_id/like` | auth; `{ type }` |

Uploaded files are served from `/storage/<file name>`.

### Reports and category requests

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/communities/:community_id/posts/:post_id/report` | auth; `{ reason, details }` |
| POST | `/api/communities/:community_id/posts/:post_id/comments/:comment_id/report` | auth |
| POST | `/api/users/:user_id/report` | auth; optional `community_id` |
| POST | `/api/communities/:community_id/category-requests` | member; `{ title, description }` (the staff create categories directly) |
| POST | `/api/category-requests/global` | owner or moderator of the community; `{ community_id, title, description }` |
| GET | `/api/category-requests/mine` | auth; your requests with their status |
| DELETE | `/api/category-requests/:request_id` | auth; cancel your pending request |

Reasons: `SPAM, HARASSMENT, HATE_SPEECH, MISINFORMATION, INAPPROPRIATE, OTHER`.

### Community moderation panel: `/api/communities/:community_id/moderation`

For the owner, the moderators and admins.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/overview` | counters (open reports, requests, bans, members, posts by status) and the recent activity |
| GET | `/reports`, `/reports/:report_id` | `status` (default `OPEN`, or `ALL`), `target_type`, `reason`, `sort=date\|reason\|status`, `order` |
| POST | `/reports/:report_id/resolve` | `{ action: NONE\|HIDE_CONTENT\|DELETE_CONTENT\|BAN_USER, note, ban_days }`; other open reports about the same target close with it |
| POST | `/reports/:report_id/dismiss` | `{ note }` |
| GET / POST | `/bans` | POST `{ user_id, reason, duration_days }`; GET `sort=date\|login\|expires`, `include_expired=true` |
| DELETE | `/bans/:user_id` | lift a ban |
| GET | `/log` | activity feed, `action`, `actor_id`, `order` |
| GET | `/category-requests` | local requests, `status` (default `PENDING`), `sort=date\|title\|status` |
| POST | `/category-requests/:request_id/approve`, `/reject` | `{ note }`; approving creates the category |

### Site panel: `/api/admin` and the web interface `/admin`

For admins and site moderators (`ADMIN` only where noted).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/overview` | site wide counters, top communities, recent activity |
| GET | `/users` | `search`, `role`, `suspended`, `sort=rating\|date\|login\|name\|posts`; emails only for admins |
| POST | `/users/:user_id/suspend`, `/unsuspend` | `ADMIN` only; `{ reason }` |
| GET | `/reports`, `/reports/:report_id` | the reports of every community, `community_id` filter |
| POST | `/reports/:report_id/resolve`, `/dismiss` | site moderators: `NONE` and `HIDE_CONTENT`; admins also `DELETE_CONTENT`, `BAN_USER`, `SUSPEND_USER` |
| GET, POST | `/category-requests`, `/category-requests/:request_id/approve`, `/reject` | `ADMIN` only; global requests are decided here |
| GET | `/moderation-log` | the activity feed of the whole site |

Open `http://localhost:5000/admin/` and sign in. The page shows the site section to admins and site moderators, and a panel for every community the
user owns or moderates. Roles are handed out by an admin with `PATCH /api/users/:user_id` (`{ "role": "MODERATOR" }`).

## Notes

- The links in the emails point to `FRONTEND_URL/auth/verify?token=...` and `FRONTEND_URL/auth/reset-password?token=...`.
  The frontend pages call `GET /api/auth/verify?token=` and `POST /api/auth/reset-password` respectively.
- The API never returns verification or reset tokens; they exist only in the emails.
- Set `CORS_ORIGINS` in production, otherwise every origin is allowed.
- Screenshots of the running solution are added together with the frontend.
