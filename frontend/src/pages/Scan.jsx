import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'

export default function Scan() {
  const videoRef = useRef(null)
  const [result, setResult] = useState('')
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let reader
    if (active) {
      setError('')
      reader = new BrowserQRCodeReader()
      reader.decodeFromVideoDevice(null, videoRef.current, (res, err) => {
        if (res) setResult(res.getText())
        if (err && !res) {
          setError('Unable to read code, adjust focus or lighting.')
        }
      })
    }
    return () => { reader && reader.reset() }
  }, [active])

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Scan inventory</h2>
            <p className="muted">Use any camera-enabled device to capture QR or barcodes.</p>
          </div>
          <button className="button" onClick={() => setActive(v => !v)}>
            {active ? 'Stop scanning' : 'Start scanning'}
          </button>
        </div>
        <div className="scanner">
          <video ref={videoRef} className="scanner__viewport" />
        </div>
        <div className="scan-result">
          <span className="muted">Last result</span>
          <p className="scan-result__value">{result || '—'}</p>
        </div>
        {error && <p className="error">{error}</p>}
        <ol className="checklist">
          <li>Point the camera at the barcode from 15–25 cm away.</li>
          <li>Ensure adequate lighting and avoid reflections on screens.</li>
          <li>Automatically open matching stock records from the inventory page.</li>
        </ol>
      </div>
    </div>
  )
}
