import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useVideoConfig } from "remotion";

export interface Chapter {
  id: string;
  title: string;
  slide: string;
  audio: string;
  durationFrames: number;
}

export const CHAPTERS: Chapter[] = [
  { id: "0", title: "项目背景与重大农业痛点", slide: "slide_0.jpg", audio: "audio_0.mp3", durationFrames: 1770 },
  { id: "1", title: "整体架构与多端生态设计", slide: "slide_1.jpg", audio: "audio_1.mp3", durationFrames: 1450 },
  { id: "2", title: "核心AI算法与多模型协同架构", slide: "slide_2.jpg", audio: "audio_2.mp3", durationFrames: 1458 },
  { id: "3", title: "精准数学量化与工业级复检闭环", slide: "slide_3.jpg", audio: "audio_3.mp3", durationFrames: 1546 },
  { id: "4", title: "真实测试验证与可视化定制导出", slide: "slide_4.jpg", audio: "audio_4.mp3", durationFrames: 1475 },
  { id: "5", title: "产业应用价值与总结展望", slide: "slide_5.jpg", audio: "audio_5.mp3", durationFrames: 1413 }
];

export const CassavaPresentation: React.FC = () => {
  let accumulatedFrames = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a" }}>
      {CHAPTERS.map((chapter, idx) => {
        const from = accumulatedFrames;
        accumulatedFrames += chapter.durationFrames;

        return (
          <Sequence key={chapter.id} from={from} durationInFrames={chapter.durationFrames}>
            <AbsoluteFill>
              <Img
                src={staticFile(`competition_video/${chapter.slide}`)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <Audio src={staticFile(`competition_video/${chapter.audio}`)} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
