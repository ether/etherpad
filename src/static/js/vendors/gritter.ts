// @ts-nocheck
// WARNING: This file has been modified from the Original

/*
 * Gritter for jQuery
 * http://www.boedesign.com/
 *
 * Copyright (c) 2012 Jordan Boesch
 * Dual licensed under the MIT and GPL licenses.
 *
 * Date: February 24, 2012
 * Version: 1.7.4
 *
 * Edited by Sebastian Castro <sebastian.castro@protonmail.com> on 2020-03-31
 *
 * Edited by Richard Hansen <rhansen@rhansen.org> on 2020-10-19 to accept jQuery or DOM objects for
 * notification title and text, and to treat plain strings as text instead of HTML (to avoid XSS
 * vunlerabilities).
 */

(function($){
	/**
	* Set it up as an object under the jQuery namespace
	*/
	$.gritter = {};

	/**
	* Set up global options that the user can over-ride
	*/
	$.gritter.options = {
		position: '',
		class_name: '', // could be set to 'gritter-light' to use white notifications
		time: 3000 // hang on the screen for...
	}

	/**
	* Add a gritter notification to the screen
	* @see Gritter#add();
	*/
	$.gritter.add = function(params){

		try {
			return Gritter.add(params || {});
		} catch(e) {

      const err = 'Gritter Error: ' + e;
      (typeof(console) != 'undefined' && console.error) ?
				console.error(err, params) :
				alert(err);

		}

	}

	/**
	* Remove a gritter notification from the screen
	* @see Gritter#removeSpecific();
	*/
	$.gritter.remove = function(id, params){
		Gritter.removeSpecific(id.split('gritter-item-')[1], params || {});
	}

	/**
	* Remove all notifications
	* @see Gritter#stop();
	*/
	$.gritter.removeAll = function(params){
		Gritter.stop(params || {});
	}

	/**
	* Big fat Gritter object
	* @constructor (not really since its object literal)
	*/
	var Gritter = {

		// Public - options to over-ride with $.gritter.options in "add"
		time: '',

		// Private - no touchy the private parts
		_custom_timer: 0,
		_item_count: 0,
		_is_setup: 0,
		_tpl_wrap_top: '<div id="gritter-container" class="top"></div>',
		_tpl_wrap_bottom: '<div id="gritter-container" class="bottom"></div>',
		_tpl_close: '',
		_tpl_title: $('<h3>').addClass('gritter-title'),
		_tpl_item: ($('<div>').addClass('popup gritter-item')
								.append($('<div>').addClass('popup-content')
												.append($('<div>').addClass('gritter-content'))
												.append($('<div>').addClass('gritter-close')
																.append($('<i>').addClass('buttonicon buttonicon-times'))))),


		/**
		* Add a gritter notification to the screen
		* @param {Object} params The object that contains all the options for drawing the notification
		* @return {Integer} The specific numeric id to that gritter notification
		*/
		add: function(params){
			// Handle straight text
			if(typeof(params) == 'string'){
				params = {text:params};
			}

			// We might have some issues if we don't have a title or text!
			if(!params.text){
				throw 'You must supply "text" parameter.';
			}

			// Check the options and set them once
			if(!this._is_setup){
				this._runSetup();
			}

			// Basics
			var title = params.title,
				text = params.text,
				image = params.image || '',
				position = params.position || 'top',
				sticky = params.sticky || false,
				item_class = params.class_name || $.gritter.options.class_name,
				time_alive = params.time || '';

			this._verifyWrapper();

			if (sticky) {
				item_class += " sticky";
			}

			this._item_count++;
			var number = this._item_count;

			// Assign callbacks
			$(['before_open', 'after_open', 'before_close', 'after_close']).each(function(i, val){
				Gritter['_' + val + '_' + number] = ($.isFunction(params[val])) ? params[val] : function(){}
			});

			// Reset
			this._custom_timer = 0;

			// A custom fade time set
			if(time_alive){
				this._custom_timer = time_alive;
			}

			// String replacements on the template
			if(title){
				title = this._tpl_title.clone().append(
						typeof title === 'string' ? document.createTextNode(title) : title);
			}else{
				title = '';
			}

			const tmp = this._tpl_item.clone();
			tmp.attr('id', `gritter-item-${number}`);
			tmp.addClass(item_class);
			tmp.find('.gritter-content')
					.append(title)
					.append(typeof text === 'string' ? $('<p>').text(text) : text);

			// If it's false, don't show another gritter message
			if(this['_before_open_' + number]() === false){
				return false;
			}

			if (['top', 'bottom'].indexOf(position) == -1) {
				position = 'top';
			}

			$('#gritter-container.' + position).append(tmp);

			var item = $('#gritter-item-' + this._item_count);

			setTimeout(function() { item.addClass('popup-show'); }, 0);
			Gritter['_after_open_' + number](item);

			if(!sticky){
				this._setFadeTimer(item, number);
				// Bind the hover/unhover states
				$(item).on('mouseenter', function(event) {
					Gritter._restoreItemIfFading($(this), number);
				});
				$(item).on('mouseleave', function(event) {
					Gritter._setFadeTimer($(this), number);
				});
			}

			// Clicking (X) makes the perdy thing close
			$(item).find('.gritter-close').click(function(){
				Gritter.removeSpecific(number, {}, null, true);
			});

			return number;

		},

		/**
		* If we don't have any more gritter notifications, get rid of the wrapper using this check
		* @private
		* @param {Integer} unique_id The ID of the element that was just deleted, use it for a callback
		* @param {Object} e The jQuery element that we're going to perform the remove() action on
		* @param {Boolean} manual_close Did we close the gritter dialog with the (X) button
		*/
		_countRemoveWrapper: function(unique_id, e, manual_close){

			// Remove it then run the callback function
			e.remove();
			this['_after_close_' + unique_id](e, manual_close);

			// Remove container if empty
			$('#gritter-container').each(function() {
				if ($(this).find('.gritter-item').length == 0) {
					$(this).remove();
				}
			})
		},

		/**
		* Fade out an element after it's been on the screen for x amount of time
		* @private
		* @param {Object} e The jQuery element to get rid of
		* @param {Integer} unique_id The id of the element to remove
		* @param {Object} params An optional list of params.
		* @param {Boolean} unbind_events Unbind the mouseenter/mouseleave events if they click (X)
		*/
		_fade: function(e, unique_id, params, unbind_events){

			var params = params || {},
				fade = (typeof(params.fade) != 'undefined') ? params.fade : true,
				manual_close = unbind_events;

			this['_before_close_' + unique_id](e, manual_close);

			// If this is true, then we are coming from clicking the (X)
			if(unbind_events){
				e.unbind('mouseenter mouseleave');
			}

			// Fade it out or remove it
			if(fade){
				e.removeClass('popup-show');
				setTimeout(function() {
					Gritter._countRemoveWrapper(unique_id, e, manual_close);
				}, 300)
			}
			else {

				this._countRemoveWrapper(unique_id, e);

			}

		},

		/**
		* Remove a specific notification based on an ID
		* @param {Integer} unique_id The ID used to delete a specific notification
		* @param {Object} params A set of options passed in to determine how to get rid of it
		* @param {Object} e The jQuery element that we're "fading" then removing
		* @param {Boolean} unbind_events If we clicked on the (X) we set this to true to unbind mouseenter/mouseleave
		*/
		removeSpecific: function(unique_id, params, e, unbind_events){

			if(!e){
				var e = $('#gritter-item-' + unique_id);
			}

			// We set the fourth param to let the _fade function know to
			// unbind the "mouseleave" event.  Once you click (X) there's no going back!
			this._fade(e, unique_id, params || {}, unbind_events);

		},

		/**
		* If the item is fading out and we hover over it, restore it!
		* @private
		* @param {Object} e The HTML element to remove
		* @param {Integer} unique_id The ID of the element
		*/
		_restoreItemIfFading: function(e, unique_id){

			clearTimeout(this['_int_id_' + unique_id]);
			e.stop().css({ opacity: '', height: '' });

		},

		/**
		* Setup the global options - only once
		* @private
		*/
		_runSetup: function(){

			for(let opt in $.gritter.options){
				this[opt] = $.gritter.options[opt];
			}
			this._is_setup = 1;

		},

		/**
		* Set the notification to fade out after a certain amount of time
		* @private
		* @param {Object} item The HTML element we're dealing with
		* @param {Integer} unique_id The ID of the element
		*/
		_setFadeTimer: function(item, unique_id){

			var timer_str = (this._custom_timer) ? this._custom_timer : this.time;
			this['_int_id_' + unique_id] = setTimeout(function(){
				Gritter._fade(item, unique_id);
			}, timer_str);

		},

		/**
		* Bring everything to a halt
		* @param {Object} params A list of callback functions to pass when all notifications are removed
		*/
		stop: function(params){

			// callbacks (if passed)
			var before_close = ($.isFunction(params.before_close)) ? params.before_close : function(){};
			var after_close = ($.isFunction(params.after_close)) ? params.after_close : function(){};

			var wrap = $('#gritter-container');
			before_close(wrap);
			wrap.fadeOut(function(){
				$(this).remove();
				after_close();
			});

		},

		/**
		* A check to make sure we have something to wrap our notices with
		* @private
		*/
		_verifyWrapper: function(){
			if ($('#gritter-container.top').length === 0) {
				$('#editorcontainerbox').append(this._tpl_wrap_top);
			}

			if ($('#gritter-container.bottom').length === 0) {
				$('#editorcontainerbox').append(this._tpl_wrap_bottom);
			}
		}

	}

})(jQuery);

// For Emacs:
// Local Variables:
// tab-width: 2
// indent-tabs-mode: t
// End:

// vi: ts=2:noet:sw=2
