window.TrelloPowerUp.initialize({
    'board-buttons': function(t, options) {
      return [{
        icon: 'https://yourdomain.com/icon.png',
        text: 'Click Me!',
        callback: function(t) {
          return t.popup({
            title: 'My Power-Up',
            url: 'popup.html'
          });
        }
      }];
    }
  });
  