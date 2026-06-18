
## Post Folder Layout

This blog now supports a folder-per-post structure.

Recommended shape:

```text
posts/
  my-post/
    content.md
    explanations.json
    images/
      cover.png
      diagram.png
```

How it works:

- `posts.json` remains the manifest that lists posts for the home page.
- Add a `folder` field to a post entry when that post lives in its own directory.
- The app loads `content.md` from that folder.
- If the folder contains `explanations.json`, those explanations are used first and then merged with the site-wide `explanations.json`.
- Explanation images live inside the post folder's `images/` directory.
- Relative image paths in the markdown are resolved against the post folder, so `images/foo.png` becomes `posts/my-post/images/foo.png`.

Legacy posts still work as before, so you can migrate them one at a time.
