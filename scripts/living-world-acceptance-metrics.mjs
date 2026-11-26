export function summarize(values) {
  if (!values.length) return { count:0, p50Ms:null, p95Ms:null, p99Ms:null, worstMs:null, over33Ms:0 };
  if (values.some(v => !Number.isFinite(v) || v < 0)) throw new RangeError('Invalid timing sample');
  const ordered = [...values].sort((a,b)=>a-b);
  const percentile = p => ordered[Math.max(0, Math.ceil(p*ordered.length)-1)];
  return { count:ordered.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),
    worstMs:ordered.at(-1),over33Ms:values.filter(v=>v>33).length };
}

export function classifyRenderer(software, name) {
  if (software) return 'production-software-fallback';
  if (typeof name !== 'string' || !name.trim() || /^(unknown|webgl|webkit webgl|angle)$/i.test(name.trim()))
    return 'unverified-webgl';
  if (/swiftshader|llvmpipe|softpipe|software raster|software render|basic render driver|lavapipe|\bwarp\b/i.test(name))
    return 'software-webgl';
  return 'hardware-candidate-unverified';
}

export function createIntervalTracker() {
  let previous = null;
  return {
    reset(){ previous=null; },
    sample(time,segment){
      if (!Number.isFinite(time)) throw new RangeError('Invalid frame timestamp');
      const interval = previous && previous.segment===segment && time>=previous.time ? time-previous.time : null;
      previous={time,segment};
      return interval;
    }
  };
}
