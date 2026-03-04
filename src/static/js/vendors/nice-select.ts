// @ts-nocheck
// WARNING: This file has been modified from the Original
// TODO: Nice Select seems relatively abandoned, we should consider other options.

/*  jQuery Nice Select - v1.1.0
    https://github.com/hernansartorio/jquery-nice-select
    Made by Hernán Sartorio  */

(function($) {

  $.fn.niceSelect = function(method) {

    // Methods
    if (typeof method == 'string') {
      if (method == 'update') {
        this.each(function() {
          var $select = $(this);
          var $dropdown = $(this).next('.nice-select');
          var open = $dropdown.hasClass('open');

          if ($dropdown.length) {
            $dropdown.remove();
            create_nice_select($select);

            if (open) {
              $select.next().trigger('click');
            }
          }
        });
      } else if (method == 'destroy') {
        this.each(function() {
          var $select = $(this);
          var $dropdown = $(this).next('.nice-select');

          if ($dropdown.length) {
            $dropdown.remove();
            $select.css('display', '');
          }
        });
        if ($('.nice-select').length == 0) {
          $(document).off('.nice_select');
        }
      } else {
        console.log('Method "' + method + '" does not exist.')
      }
      return this;
    }

    // Hide native select
    this.hide();

    // Create custom markup
    this.each(function() {
      var $select = $(this);

      if (!$select.next().hasClass('nice-select')) {
        create_nice_select($select);
      }
    });

    function create_nice_select($select) {
      $select.after($('<div></div>')
        .addClass('nice-select')
        .addClass($select.attr('class') || '')
        .addClass($select.attr('disabled') ? 'disabled' : '')
        .attr('tabindex', $select.attr('disabled') ? null : '0')
        .html('<span class="current"></span><ul class="list thin-scrollbar"></ul>')
      );

      var $dropdown = $select.next();
      var $options = $select.find('option');
      var $selected = $select.find('option:selected');

      $dropdown.find('.current').html($selected.data('display') || $selected.text());

      $options.each(function(i) {
        var $option = $(this);
        var display = $option.data('display');

        $dropdown.find('ul').append($('<li></li>')
          .attr('data-value', $option.val())
          .attr('data-display', (display || null))
          .addClass('option' +
            ($option.is(':selected') ? ' selected' : '') +
            ($option.is(':disabled') ? ' disabled' : ''))
          .html($option.text())
        );
      });
    }

    /* Event listeners */

    // Unbind existing events in case that the plugin has been initialized before
    $(document).off('.nice_select');

    // Open/close
    $(document).on('click.nice_select', '.nice-select', function(event) {
      var $dropdown = $(this);

      $('.nice-select').not($dropdown).removeClass('open');

      $dropdown.toggleClass('open');

      if ($dropdown.hasClass('open')) {
        $dropdown.find('.option');
        $dropdown.find('.focus').removeClass('focus');
        $dropdown.find('.selected').addClass('focus');
        if ($dropdown.closest('.toolbar').length > 0) {
          $dropdown.find('.list').css('left', $dropdown.offset().left);
          $dropdown.find('.list').css('top', $dropdown.offset().top + $dropdown.outerHeight());
          $dropdown.find('.list').css('min-width', $dropdown.outerWidth() + 'px');
        }

        let $listHeight = $dropdown.find('.list').outerHeight();
        let $top = $dropdown.parent().offset().top;
        let $bottom = $('body').height() - $top;
        let $maxListHeight = $bottom - $dropdown.outerHeight() - 20;
        if ($maxListHeight < 200) {
          $dropdown.addClass('reverse');
          $maxListHeight = 250;
        } else {
          $dropdown.removeClass('reverse')
        }
        $dropdown.find('.list').css('max-height', $maxListHeight + 'px');

      } else {
        $dropdown.trigger('focus');
      }
    });

    // Close when clicking outside
    $(document).on('click.nice_select', function(event) {
      if ($(event.target).closest('.nice-select').length === 0) {
        $('.nice-select').removeClass('open').find('.option');
      }
    });

    // Option click
    $(document).on('click.nice_select', '.nice-select .option:not(.disabled)', function(event) {
      var $option = $(this);
      var $dropdown = $option.closest('.nice-select');

      $dropdown.find('.selected').removeClass('selected');
      $option.addClass('selected');

      var text = $option.data('display') || $option.text();
      $dropdown.find('.current').text(text);

      $dropdown.prev('select').val($option.data('value')).trigger('change');
    });

    // Keyboard events
    $(document).on('keydown.nice_select', '.nice-select', function(event) {
      var $dropdown = $(this);
      var $focused_option = $($dropdown.find('.focus') || $dropdown.find('.list .option.selected'));

      // Space or Enter
      if (event.keyCode == 32 || event.keyCode == 13) {
        if ($dropdown.hasClass('open')) {
          $focused_option.trigger('click');
        } else {
          $dropdown.trigger('click');
        }
        return false;
      // Down
      } else if (event.keyCode == 40) {
        if (!$dropdown.hasClass('open')) {
          $dropdown.trigger('click');
        } else {
          var $next = $focused_option.nextAll('.option:not(.disabled)').first();
          if ($next.length > 0) {
            $dropdown.find('.focus').removeClass('focus');
            $next.addClass('focus');
          }
        }
        return false;
      // Up
      } else if (event.keyCode == 38) {
        if (!$dropdown.hasClass('open')) {
          $dropdown.trigger('click');
        } else {
          var $prev = $focused_option.prevAll('.option:not(.disabled)').first();
          if ($prev.length > 0) {
            $dropdown.find('.focus').removeClass('focus');
            $prev.addClass('focus');
          }
        }
        return false;
      // Esc
      } else if (event.keyCode == 27) {
        if ($dropdown.hasClass('open')) {
          $dropdown.trigger('click');
        }
      // Tab
      } else if (event.keyCode == 9) {
        if ($dropdown.hasClass('open')) {
          return false;
        }
      }
    });

    // Detect CSS pointer-events support, for IE <= 10. From Modernizr.
    var style = document.createElement('a').style;
    style.cssText = 'pointer-events:auto';
    if (style.pointerEvents !== 'auto') {
      $('html').addClass('no-csspointerevents');
    }

    return this;

  };

}(jQuery));
