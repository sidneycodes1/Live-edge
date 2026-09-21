export function marketImageUrl(question) {
  return `https://via.placeholder.com/1024/15151C/3DFFB5?text=${encodeURIComponent(question.slice(0,30))}`;
}
