import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'

export default function Scan() {
  const videoRef = useRef(null)
  const [result, setResult] = useState('')
  const [active, setActive] = useState(false)

  useEffect(() => {
    let reader
    if (active) {
      reader = new BrowserQRCodeReader()
      reader.decodeFromVideoDevice(null, videoRef.current, (res, err) => {
        if (res) setResult(res.getText())
      })
    }
    return () => { reader && reader.reset(); }
  }, [active])

  return (
    <div className="container">
      <div className="card">
        <h2>Scan (QR/Barcode)</h2>
        <button onClick={() => setActive(v => !v)}>{active ? 'Stop' : 'Start'}</button>
        <div style={{marginTop:12}}>
          <video ref={videoRef} style={{width:'100%', maxWidth:480, borderRadius:12}} />
        </div>
        <p>Result: <b>{result}</b></p>
      </div>
    </div>
  )
}
