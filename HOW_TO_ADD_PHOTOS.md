# How to Add Photos to the Website

## Step 1: Create the Images Folder

1. Navigate to: `C:\Users\ngafn\OneDrive\Desktop\Exchange\nddelta-website\public\`
2. Create a new folder called `images`

## Step 2: Add Your Photos

Place your photos in the `public/images/` folder:

### Leadership Photos (5 photos needed)
- **george.jpg** - George Gardey's photo
- **calvin.jpg** - Calvin Bacall's photo
- **nathan.jpg** - Nathan Gafney's photo
- **member4.jpg** - 4th board member's photo
- **member5.jpg** - 5th board member's photo

**Recommended size**: 600x800px (3:4 aspect ratio) or larger

### About Section Photo (1 photo needed)
- **group-photo.jpg** - DELTA club group photo

**Recommended size**: 500x500px (square) or larger

### Trading Competition Photo (1 photo needed)
- **trading-room.jpg** - Photo of Mendoza Trading Room or competition

**Recommended size**: 500x500px (square) or larger

## Step 3: Update the Code

### For Leadership Photos

Open `src/App.js` and find each leader card. Replace:

```javascript
<div className="leader-photo">G</div>
```

With:

```javascript
<img src="/images/george.jpg" alt="George Gardey" className="leader-photo-img" />
```

Do this for all 5 leaders (update the filename and alt text for each).

### For About Section Photo

Find this line in `src/App.js`:

```javascript
<div className="placeholder-image-large">
  <span className="placeholder-icon-large">Δ</span>
</div>
```

Replace with:

```javascript
<img src="/images/group-photo.jpg" alt="DELTA Club" className="about-photo-img" />
```

### For Trading Competition Photo

Find this line in `src/App.js`:

```javascript
<div className="placeholder-image-competition">
  <span className="placeholder-icon-competition">📈</span>
</div>
```

Replace with:

```javascript
<img src="/images/trading-room.jpg" alt="Mendoza Trading Room" className="competition-photo-img" />
```

## Step 4: Add CSS for the Images

Open `src/App.css` and add these styles:

```css
/* Leadership Photos */
.leader-photo-img {
  width: 120px;
  height: 120px;
  border-radius: 0.75rem;
  object-fit: cover;
  box-shadow: 0 4px 15px rgba(96, 165, 250, 0.4);
}

/* About Section Photo */
.about-photo-img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 1rem;
  object-fit: cover;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

/* Competition Photo */
.competition-photo-img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 1rem;
  object-fit: cover;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}
```

## Step 5: Test

1. Save all files
2. The website should automatically reload
3. Check that all photos appear correctly
4. Adjust image sizes if needed

## Notes

- Use `.jpg`, `.png`, or `.webp` formats
- Keep file sizes reasonable (under 1MB each for faster loading)
- Make sure photo names match exactly (case-sensitive)
- Photos in the `public/` folder are referenced with `/images/filename.jpg` (starting with `/`)
