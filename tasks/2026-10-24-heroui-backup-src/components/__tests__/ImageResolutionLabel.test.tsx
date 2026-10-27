import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageResolutionLabel from '../ImageResolutionLabel';
import { isLowResolution } from '../../utils/imageResolution';

describe('resolution screening', () => {
  it('handles portrait, exact boundary, narrow image and unknown', () => {
    expect(isLowResolution(1024, 512)).toBe(false);
    expect(isLowResolution(512, 1024)).toBe(false);
    expect(isLowResolution(2000, 511)).toBe(true);
    expect(isLowResolution(1023, 700)).toBe(true);
    expect(isLowResolution(null, null)).toBe(null);
  });
  it('shows the low resolution label beneath original dimensions', () => {
    render(<ImageResolutionLabel width={791} height={442} />);
    expect(screen.getByText('低分辨率')).toBeInTheDocument();
    expect(screen.getByText('791 × 442 px')).toBeInTheDocument();
  });
  it('does not mislabel a high resolution image or an unknown one', () => {
    const view = render(<ImageResolutionLabel width={4032} height={2268} />);
    expect(screen.queryByText('低分辨率')).not.toBeInTheDocument();
    view.rerender(<ImageResolutionLabel />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
