# DELTA Website

Official website for DELTA (Discovering Econometrics: Learning Through Application) at Notre Dame, live at https://nddelta.com.

## What's here

| path | what |
| --- | --- |
| `src/` | the homepage and `/games` (Create React App). All the copy lives in `src/content.js`. |
| `week1/` … `week6/` | the weekly meeting games, each its own Vite app + API, served at `/weekN/` |
| `api/weekN/` | the Vercel functions for each week's API |
| `solo/` | single-player builds of every week, served at `/solo/weekN/`: the week's real game server runs in the browser and bot traders fill the room. See the header of `solo/vite.config.js`. |

## Development

```bash
npm install
npm start            # the homepage on :3000
```

## Deploy

Push to `main`. Vercel runs `npm run build`, which builds every week into `public/weekN/`, every solo build into `public/solo/weekN/`, then the homepage.
