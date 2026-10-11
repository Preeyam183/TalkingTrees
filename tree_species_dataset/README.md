# Tree species image starter set

This starter pack downloads one real tree photo for each of ten visually distinct tree labels: oak, maple, pine, palm, birch, willow, cherry blossom, redwood, baobab, and eucalyptus.

The downloaded files are placed in `images/`. `images/manifest.csv` records the Wikimedia Commons file page, creator, license, and attribution for each image. The downloader accepts only images whose Commons metadata identifies a public-domain, CC0, CC BY, or CC BY-SA license. Review the manifest and each source page before redistribution; attribution terms differ by license.

## Download

Requires Python 3.9+ and internet access.

```bash
python3 -m pip install -r requirements.txt
python3 download_dataset.py
```

The script may find a different eligible image if Commons search results change. It exits with an error if any label cannot be found so you can rerun it or select a replacement manually. Keep the manifest with the images.

## OpenCV use

Images use one file per class, suitable for a UI/demo or testing an image-processing pipeline. One image per class is far too small to train or evaluate a reliable species classifier. For that, collect many varied photos per species (different seasons, lighting, distances, and backgrounds), then split by source/tree before training and evaluation.

Do not use color alone as a label cue: seasonal changes and lighting can make leaves misleading. The images are whole-tree scenes, not verified botanical close-ups.
