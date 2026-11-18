  // ============================================================
  // FILE DOWNLOAD
  // ============================================================
  // Shared helper for the .fit / timeline-image / ride-log-JSON exports.
  function downloadBinary(bytes, filename, mime){
    var blob = new Blob([bytes], {type:mime || 'application/octet-stream'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }
