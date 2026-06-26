import StubView from './StubView'
export default function Downscale() {
  return (
    <StubView
      title="DOWNSCALE"
      milestone="M6"
      blurb="Coarse → bilinear → SR-CNN super-resolution trio with improvement %. Hidden when no downscaler checkpoint is available (as in this deployment)."
    />
  )
}
