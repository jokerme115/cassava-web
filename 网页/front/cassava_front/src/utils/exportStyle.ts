export type ExportStage = 'original' | 'yolo' | 'prediction';
export interface FigureStyle {
  stages?: ExportStage[]; stage_layout?: 'rows' | 'columns';
  cassava_color: string; rotten_color: string; cassava_line_width: number; rotten_line_width: number;
  cassava_fill: boolean; rotten_fill: boolean; cassava_opacity: number; rotten_opacity: number;
  font_size: number; show_ppd: boolean; show_filename: boolean; columns: number; padding: number; panel_width: number; collage: boolean;
}
export interface ExportTemplate { name: string; version: number; style: FigureStyle }
export const referenceStyle: FigureStyle = {
  stages: ['original', 'yolo', 'prediction'], stage_layout: 'rows',
  cassava_color: '#34d9cf', rotten_color: '#ff5b7f', cassava_line_width: 2, rotten_line_width: 2,
  cassava_fill: false, rotten_fill: false, cassava_opacity: .2, rotten_opacity: .35, font_size: 36, show_ppd: true,
  show_filename: false, columns: 3, padding: 20, panel_width: 600, collage: false,
};
