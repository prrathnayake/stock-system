import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { useAuth } from '../providers/AuthProvider.jsx'

export default function Scan() {
  const videoRef = useRef(null)
  const [result, setResult] = useState('')
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const { organization } = useAuth()
  const barcodeEnabled = organization?.features?.barcode_scanning_enabled !== false

  useEffect(() => {
    let reader
    if (active && barcodeEnabled) {
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
  }, [active, barcodeEnabled])

  useEffect(() => {
    if (!barcodeEnabled) {
      setActive(false)
    }
  }, [barcodeEnabled])

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Scan inventory</h2>
            <p className="muted">
              {barcodeEnabled
                ? 'Use any camera-enabled device to capture QR or barcodes.'
                : 'Administrators have disabled the in-app scanner. Contact your developer to re-enable camera scanning.'}
            </p>
          </div>
          <button
            className="button"
            onClick={() => setActive((v) => !v)}
            disabled={!barcodeEnabled}
          >
            {active ? 'Stop scanning' : 'Start scanning'}
          </button>
        </div>
        <div className="scanner">
          {barcodeEnabled ? (
            <video ref={videoRef} className="scanner__viewport" />
          ) : (
            <div className="scanner__viewport scanner__viewport--disabled">Scanner unavailable</div>
          )}
        </div>
        <div className="scan-result">
          <span className="muted">Last result</span>
          <p className="scan-result__value">{result || '—'}</p>
        </div>
        {error && barcodeEnabled && <p className="error">{error}</p>}
        <ol className="checklist">
          <li>Point the camera at the barcode from 15–25 cm away.</li>
          <li>Ensure adequate lighting and avoid reflections on screens.</li>
          <li>Automatically open matching stock records from the inventory page.</li>
        </ol>
      </div>
    </div>
  )
}
