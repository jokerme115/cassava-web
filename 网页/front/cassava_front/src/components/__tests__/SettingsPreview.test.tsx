import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FigureSettingsPreview, ImportSettingsPreview, ListSettingsPreview } from '../SettingsPreview';
import { defaultPreferences } from '../../utils/userPreferences';
import { referenceStyle } from '../../utils/exportStyle';
import { useState } from 'react';
import FigureStyleFields from '../FigureStyleFields';

describe('settings effect previews', () => {
  it('lets users select, reorder and retain at least one exported content block', () => {
    function Editor() {
      const [value,setValue] = useState(referenceStyle);
      return <><FigureStyleFields value={value} onChange={setValue}/><FigureSettingsPreview value={value}/></>;
    }
    const { container } = render(<Editor/>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'YOLO 子图' }));
    expect(container.querySelectorAll('.preview-composite-block')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '预测结果前移' }));
    expect(container.querySelector('.preview-composite-block')).toHaveAttribute('aria-label', '预测结果');
    fireEvent.click(screen.getByRole('checkbox', { name: '原图' }));
    expect(screen.getByRole('checkbox', { name: '预测结果' })).toBeDisabled();
    expect(container.querySelectorAll('.preview-composite-block')).toHaveLength(1);
  });
  it('lets mobile users expand the preview without losing current settings', () => {
    render(<ImportSettingsPreview value={{ ...defaultPreferences, preserveHierarchy: false }}/>);
    fireEvent.click(screen.getByRole('button', { name: '展开导入后的目录预览' }));
    expect(screen.getByRole('button', { name: '收起导入后的目录预览' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('切面01.jpg')).toBeInTheDocument();
  });
  it('shows the resulting archive paths for flattened and preserved imports', () => {
    const { rerender, container } = render(<ImportSettingsPreview value={defaultPreferences}/>);
    expect(screen.getByLabelText('导入后的目录')).toHaveTextContent('当前目录 / 木薯实验');
    expect(container.querySelectorAll('.preview-tree-folder')).toHaveLength(2);
    rerender(<ImportSettingsPreview value={{ ...defaultPreferences, importMode: 'existing', preserveHierarchy: false }}/>);
    expect(screen.getByLabelText('导入后的目录')).not.toHaveTextContent('当前目录 / 木薯实验');
    expect(container.querySelectorAll('.preview-tree-folder')).toHaveLength(0);
    expect(container.querySelectorAll('.preview-tree-image')).toHaveLength(2);
  });
  it('reflects list layout, page size, grouping and sort direction', () => {
    const { container, rerender } = render(<ListSettingsPreview value={{ ...defaultPreferences, listSort: 'name', listOrder: 'asc' }}/>);
    expect(container.querySelector('.preview-image-grid')).toBeTruthy();
    expect(container.querySelector('.preview-image-content strong')).toHaveTextContent('木薯切面_01.jpg');
    rerender(<ListSettingsPreview value={{ ...defaultPreferences, listView: 'list', listPageSize: 96, listSort: 'name', listOrder: 'desc', listGroup: 'none' }}/>);
    expect(container.querySelector('.preview-image-list')).toBeTruthy();
    expect(container.querySelector('.preview-group')).toBeNull();
    expect(container.querySelector('.preview-image-content strong')).toHaveTextContent('木薯切面_03.jpg');
    expect(screen.getByText('每页 96 项')).toBeInTheDocument();
  });
  it('renders style changes without assigning invented PPD values', () => {
    const { container } = render(<FigureSettingsPreview value={{ ...referenceStyle, cassava_color: '#123456', collage: true, columns: 2, show_filename: true }}/>);
    expect(screen.getAllByRole('img', { name: '木薯切面效果示例' })).toHaveLength(18);
    expect(container.querySelector('path')).toHaveAttribute('stroke', '#123456');
    expect(screen.getAllByText('PPD = —%')).toHaveLength(6);
    expect(screen.getAllByText('原图1_切面1.jpg')).toHaveLength(2);
  });
  it('combines selected stages into one figure in the configured order and layout', () => {
    const { container, rerender } = render(<FigureSettingsPreview value={referenceStyle}/>);
    expect(container.querySelectorAll('.preview-composite-block')).toHaveLength(3);
    expect(screen.getAllByText('PPD = —%')).toHaveLength(3);
    expect(container.querySelector('.preview-composite--rows')).toBeTruthy();
    rerender(<FigureSettingsPreview value={{ ...referenceStyle, stages: ['prediction', 'original'], stage_layout: 'columns' }}/>);
    expect(container.querySelectorAll('.preview-composite-block')).toHaveLength(2);
    expect(container.querySelector('.preview-composite-block')).toHaveAttribute('aria-label', '预测结果');
    expect(container.querySelector('.preview-composite--columns')).toBeTruthy();
    expect(container.querySelector('[aria-label="YOLO 子图"]')).toBeNull();
  });
});
