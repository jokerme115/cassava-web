import React from "react";
import { Composition } from "remotion";
import { CassavaPresentation, CHAPTERS } from "./Composition";

export const Root: React.FC = () => {
  const totalFrames = CHAPTERS.reduce((acc, c) => acc + c.durationFrames, 0);

  return (
    <>
      <Composition
        id="CassavaPresentation"
        component={CassavaPresentation}
        durationInFrames={totalFrames}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
