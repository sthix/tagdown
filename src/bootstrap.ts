if (new URLSearchParams(location.search).has('quick-capture')) {
  void import('./quickCaptureWindow');
} else {
  void import('./main');
}
