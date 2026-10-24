"""Keep source and mask in the same geometry when mapping model output back."""
from PIL import Image
from tryon_geometry import fit_geometry, fit_image


def prepare_inputs(source, mask, size):
    if source.size != mask.size:
        raise ValueError('Source image and mask must have the same size')
    geometry = fit_geometry(source.size, size)
    return fit_image(source, geometry), fit_image(mask, geometry, mask=True)
