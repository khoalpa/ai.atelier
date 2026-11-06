const PERSON_REASON = 'Phát hiện người hoặc pose trong ảnh sản phẩm';

// A recorded visual review can resolve a pose false positive, never other gates.
function applyProductReview(validation, review, digest) {
  if (!review) return validation;
  if (review.noPerson !== true || review.sha256 !== digest || validation.metrics?.sha256 !== digest || typeof review.reviewer !== 'string' || !review.reviewer.trim() || review.reviewer.length > 100) {
    throw new Error('Xác nhận trực quan không hợp lệ hoặc không khớp ảnh đang lưu.');
  }
  if (validation.ok !== true || !Array.isArray(validation.reasons)) throw new Error('Thiếu kết quả kiểm định ảnh.');
  const reasons=validation.reasons.filter(reason=>reason!==PERSON_REASON);
  return {...validation,accepted:reasons.length===0,reasons,manualReview:{noPerson:true,sha256:digest,reviewer:review.reviewer.trim(),reviewedAt:new Date().toISOString(),resolvedReasons:validation.reasons.filter(reason=>reason===PERSON_REASON)}};
}

module.exports={applyProductReview};
