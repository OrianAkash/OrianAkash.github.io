# Akash — portfolio

Personal portfolio site. Plain HTML, CSS and JavaScript, no build step.

```
index.html      all page content
css/style.css   colours, type and layout (tokens at the top)
js/main.js      hero signal line, light/dark toggle, heat-warning demo, project filter, reels, copy email
resume.pdf      add this yourself (the "Download resume" buttons link to it)
photo.jpg       optional portrait for the About section (hidden until you add it)
```

## Before publishing

1. Put your resume in this folder as `resume.pdf`.
2. Read through the About section and project text, and change anything that doesn't sound like you.
3. Optional: add your GitHub profile and LinkedIn to the contact section in `index.html`.
4. Optional: add a portrait as `photo.jpg` (4:5 crop works best).

## Preview locally

Open `index.html` in a browser, or run a tiny server from this folder:

```
python -m http.server 8000
```

then go to http://localhost:8000.

## Publish on GitHub Pages (free)

1. Create a new public repository named `<your-github-username>.github.io`.
2. Upload everything in this folder (keep the `css` and `js` folders).
3. In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-github-username>.github.io`.

## Editing

- **Add a project:** copy one `<article class="project">` block (big, with a diagram) or one `<li class="index-row">` block (compact) in `index.html`.
- **Filter tags:** each project's `data-tags` attribute lists its tags: `engine`, `audio`, `gameplay`, `ai`, `design`, `lead`.
- **Video thumbnails:** use `https://i.ytimg.com/vi/<VIDEO_ID>/hqdefault.jpg`, where the ID is the part after `youtu.be/`.
- **Colours and fonts:** change the variables at the top of `css/style.css`.
