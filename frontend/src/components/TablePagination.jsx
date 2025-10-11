import React from 'react'

export default function TablePagination({ page, totalPages, onPrev, onNext, className = '' }) {
  if (totalPages <= 1) return null
  return (
    <div className={`table-pagination${className ? ` ${className}` : ''}`}>
      <button type="button" className="button button--ghost" onClick={onPrev} disabled={page <= 1}>
        Previous
      </button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" className="button button--ghost" onClick={onNext} disabled={page >= totalPages}>
        Next
      </button>
    </div>
  )
}
