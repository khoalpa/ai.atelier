"""Strict input and experiment accounting for local, non-production VTON pilots."""
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_dataset(root):
    root = Path(root).resolve()
    rows = [json.loads(line) for line in (root/'manifest.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    if not rows:
        raise ValueError('Dataset is empty')
    ids, products, photos = set(), {}, {}
    geometry=None
    counts = {'train':0, 'validation':0}
    for row in rows:
        if not isinstance(row,dict) or any(not isinstance(row.get(field),str) or
                re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,63}',row[field]) is None
                for field in ('id','productId')):
            raise ValueError('Record and product IDs must be safe filename components')
        if row['id'] in ids:
            raise ValueError('Duplicate record ID')
        ids.add(row['id'])
        split = row['split']
        if split not in counts or row['category'] != 'upper_body':
            raise ValueError('Pilot requires train/validation upper_body records')
        if row.get('provenance',{}).get('synthetic') is not False:
            raise ValueError('Synthetic targets are not accepted')
        if row.get('quality',{}).get('maskReview') != 'accepted_for_pilot':
            raise ValueError('Every mask must be visually reviewed before training')
        for field in ('productImage','personImage','maskImage'):
            path = (root/row[field]).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError('Image path must be an existing file inside the dataset')
            if file_hash(path) != row.get('preparedHashes',{}).get(field):
                raise ValueError('Prepared image changed after review')
        if row['preparedHashes']['productImage'] == row['preparedHashes']['personImage']:
            raise ValueError('Product and person photographs must be distinct')
        with Image.open(root/row['personImage']) as person, Image.open(root/row['maskImage']) as mask:
            if person.size not in ((384,512),(576,768),(768,1024)) or mask.size != person.size:
                raise ValueError('Person and mask must have matching supported 3:4 geometry')
            if geometry is not None and person.size != geometry:
                raise ValueError('All pilot records must use the same geometry')
            geometry=person.size
            values = np.asarray(mask.convert('L'))
            if not set(np.unique(values)).issubset({0,255}) or not .01 < (values>0).mean() < .7:
                raise ValueError('Mask must be binary with plausible coverage')
        for mapping, value in ((products,row['productId']), (photos,row['preparedHashes']['personImage']),
                               (products,row['preparedHashes']['productImage'])):
            if value in mapping and mapping[value] != split:
                raise ValueError('Product or photograph leaks between train and validation')
            mapping[value] = split
        counts[split] += 1
    if counts['train'] < 24 or counts['validation'] < 6:
        raise ValueError('Exploratory pilot needs at least 24 train and 6 validation pairs')
    return rows


def build_inpaint_batch(person, garment, masked_person, mask, noise, timesteps, scheduler, drop_condition=False):
    import torch
    clean = torch.cat([person,garment],dim=-2)
    if noise.shape != clean.shape:
        raise ValueError('Noise must match the spatially concatenated latent shape')
    noisy = scheduler.add_noise(clean, noise, timesteps)
    conditioning = torch.cat([masked_person,torch.zeros_like(garment) if drop_condition else garment],dim=-2)
    mask_pair = torch.cat([mask,torch.zeros_like(mask)],dim=-2)
    return torch.cat([noisy,mask_pair,conditioning],dim=1), noise


def masked_mae(target, prediction, mask):
    a, b = np.asarray(target).astype(float), np.asarray(prediction).astype(float)
    region = np.asarray(mask)>0
    if not region.any():
        raise ValueError('Cannot score an empty edit region')
    return float(np.abs(a-b)[region].mean())
