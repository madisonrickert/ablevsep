export interface OriginalClipInfo {
  startTime: number;
  duration: number;
  warping: boolean;
  startMarker: number;
  endMarker: number;
  looping: boolean;
  loopStart: number;
  loopEnd: number;
  color: number;
  name: string;
}

export interface LoopSettings {
  looping: boolean;
  startMarker: number;
  endMarker: number;
  loopStart: number;
  loopEnd: number;
}

export interface ArrangementClipArgs {
  filePath: string;
  startTime: number;
  duration: number;
  isWarped: false;
}

export interface SessionClipArgs {
  filePath: string;
  isWarped: false;
  loopSettings?: LoopSettings;
}

export function stemNameFromFilename(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

export function stemTrackName(clipName: string, stemName: string): string {
  const base = clipName.trim() ? clipName.trim() : "Clip";
  return `${base} — ${stemName}`;
}

export function arrangementClipArgs(filePath: string, orig: OriginalClipInfo): ArrangementClipArgs {
  return { filePath, startTime: orig.startTime, duration: orig.duration, isWarped: false };
}

export function sessionClipArgs(filePath: string, orig: OriginalClipInfo): SessionClipArgs {
  // Warped session clips can't reproduce the warp map → place the full sample unwarped.
  if (orig.warping) return { filePath, isWarped: false };
  // Unwarped: mirror the region. looping must be false when isWarped is false, so
  // loopStart/loopEnd must equal startMarker/endMarker.
  return {
    filePath,
    isWarped: false,
    loopSettings: {
      looping: false,
      startMarker: orig.startMarker,
      endMarker: orig.endMarker,
      loopStart: orig.startMarker,
      loopEnd: orig.endMarker,
    },
  };
}
