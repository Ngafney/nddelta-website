# Quick Guide: Adding Photos to Your Website

## Step 1: Prepare Your Photos

### Profile Photos (Leadership Section)
- **Dimensions**: 600px wide × 800px tall (3:4 ratio)
- **Format**: JPG or WebP
- **File size**: Under 200KB each
- **Names**: Use simple names like `george-gardey.jpg`, `calvin-bacall.jpg`, etc.

### Group Photo (About Section)  
- **Dimensions**: 500px × 500px (square)
- **Format**: JPG or WebP
- **File size**: Under 300KB
- **Name**: `delta-team.jpg` or `group-photo.jpg`

## Step 2: Add Photos to Project

1. Create an `images` folder in the `public` directory:
   ```
   nddelta-website/
   └── public/
       └── images/
           ├── george-gardey.jpg
           ├── calvin-bacall.jpg
           ├── nathan-gafney.jpg
           ├── member4.jpg
           ├── member5.jpg
           └── delta-team.jpg
   ```

## Step 3: Update Code

### For Leadership Photos (in App.js)

**Find this:**
```jsx
<div className="leader-photo">G</div>
```

**Replace with:**
```jsx
<img 
  src="/images/george-gardey.jpg" 
  alt="George Gardey" 
  style={{
    width: '100%', 
    height: '100%', 
    objectFit: 'cover',
    objectPosition: 'center top'
  }} 
/>
```

**Repeat for all 5 board members:**
- George Gardey → `/images/george-gardey.jpg`
- Calvin Bacall → `/images/calvin-bacall.jpg`
- Nathan Gafney → `/images/nathan-gafney.jpg`
- Member 4 → `/images/member4.jpg`
- Member 5 → `/images/member5.jpg`

### For Group Photo (in App.js)

**Find this:**
```jsx
<div className="placeholder-image-small">
  <span className="placeholder-icon-small">Δ</span>
</div>
```

**Replace with:**
```jsx
<img 
  src="/images/delta-team.jpg" 
  alt="DELTA Team" 
  style={{
    width: '100%', 
    height: '100%', 
    objectFit: 'cover',
    borderRadius: '1rem'
  }} 
/>
```

## Step 4: Update Board Member Info

**Find the last 2 leader cards and update:**

```jsx
<div className="leader-card">
  <div className="leader-image">
    <img 
      src="/images/member4.jpg" 
      alt="Full Name" 
      style={{
        width: '100%', 
        height: '100%', 
        objectFit: 'cover',
        objectPosition: 'center top'
      }} 
    />
  </div>
  <div className="leader-info">
    <h3>Full Name Here</h3>
    <p className="role">Their Role Title</p>
    <a href="mailto:email@nd.edu" className="email">email@nd.edu</a>
  </div>
</div>
```

## Pro Tips

### Image Optimization
- Use [TinyPNG.com](https://tinypng.com) to compress images
- Convert to WebP for better performance (optional)
- Use tools like Photoshop or GIMP to crop to exact dimensions

### Photo Cropping for Profiles
- **Headshots work best** - shoulders and up
- **Center the face** in the frame
- **Good lighting** - avoid dark or overexposed photos
- **Consistent style** - same type of background/lighting for all 5

### objectPosition Options
If faces are cut off, adjust the `objectPosition`:
- `'center top'` - shows top of image (default, best for headshots)
- `'center center'` - shows middle of image
- `'center 20%'` - custom position (20% from top)

## Testing

After adding photos:
1. Save all files
2. The development server will auto-reload
3. Check that all images load properly
4. Verify they look good on mobile (open DevTools → mobile view)

## Troubleshooting

**Image not showing?**
- Check the file path is correct
- Verify the file is in `public/images/`
- Make sure filename matches exactly (case-sensitive)
- Clear browser cache and reload

**Image looks stretched or cropped weird?**
- Adjust `objectPosition` value
- Re-crop the original photo to 3:4 ratio
- Use `objectFit: 'contain'` instead of `'cover'` (may show background)

---

**Need help?** The photos should "just work" once placed in the `public/images/` folder with the correct filenames!
