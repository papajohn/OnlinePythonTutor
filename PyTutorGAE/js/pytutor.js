/*

Online Python Tutor
https://github.com/pgbovine/OnlinePythonTutor/

Copyright (C) 2010-2012 Philip J. Guo (philip@pgbovine.net)

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/


/* To import, put this at the top of your HTML page:

<!-- requirements for pytutor.js -->
<script type="text/javascript" src="js/d3.v2.min.js"></script>
<script type="text/javascript" src="js/jquery-1.6.min.js"></script>
<script type="text/javascript" src="js/jquery.ba-bbq.min.js"></script> <!-- for handling back button and URL hashes -->
<script type="text/javascript" src="js/jquery.jsPlumb-1.3.10-all-min.js "></script> <!-- for rendering SVG connectors -->
<script type="text/javascript" src="js/jquery-ui-1.8.21.custom.min.js"></script> <!-- for sliders and other UI elements -->
<link type="text/css" href="css/ui-lightness/jquery-ui-1.8.21.custom.css" rel="stylesheet" />

<script type="text/javascript" src="js/pytutor.js"></script>
<link rel="stylesheet" href="css/pytutor.css"/>

*/



var curVisualizerID = 1; // global to uniquely identify each ExecutionVisualizer instance

// domRootID is the string ID of the root element where to render this instance
// dat is data returned by the Python Tutor backend consisting of two fields:
//   code  - string of executed code
//   trace - a full execution trace
// params contains optional parameters, such as:
//   jumpToEnd - if non-null, jump to the very end of execution
//   startingInstruction - the (zero-indexed) execution point to display upon rendering
//   hideOutput - hide "Program output" and "Generate URL" displays
//   codeDivHeight - maximum height of #pyCodeOutputDiv (in pixels)
//   editCodeBaseURL - the base URL to visit when the user clicks 'Edit code'
function ExecutionVisualizer(domRootID, dat, params) {
  this.curInputCode = dat.code.rtrim(); // kill trailing spaces
  this.curTrace = dat.trace;

  this.curInstr = 0;

  this.params = params;

  // needs to be unique!
  this.visualizerID = curVisualizerID;
  curVisualizerID++;


  // cool, we can create a separate jsPlumb instance for each visualization:
  this.jsPlumbInstance = jsPlumb.getInstance({
    Endpoint: ["Dot", {radius:3}],
    EndpointStyles: [{fillStyle: connectorBaseColor}, {fillstyle: null} /* make right endpoint invisible */],
    Anchors: ["RightMiddle", "LeftMiddle"],
    PaintStyle: {lineWidth:1, strokeStyle: connectorBaseColor},

    // bezier curve style:
    //Connector: [ "Bezier", { curviness:15 }], /* too much 'curviness' causes lines to run together */
    //Overlays: [[ "Arrow", { length: 14, width:10, foldback:0.55, location:0.35 }]],

    // state machine curve style:
    Connector: [ "StateMachine" ],
    Overlays: [[ "Arrow", { length: 10, width:7, foldback:0.55, location:1 }]],
    EndpointHoverStyles: [{fillStyle: connectorHighlightColor}, {fillstyle: null} /* make right endpoint invisible */],
    HoverPaintStyle: {lineWidth: 1, strokeStyle: connectorHighlightColor},
  });


  this.visitedLinesSet = null; // will change at every execution point


  // true iff trace ended prematurely since maximum instruction limit has
  // been reached
  var instrLimitReached = false;


  this.domRoot = $('#' + domRootID);

  this.domRootD3 = d3.select('#' + domRootID);

  this.keyStuckDown = false;


  // initialize in renderPyCodeOutput()
  this.codeOutputLines = null;
  this.breakpoints = null;           // set of execution points to set as breakpoints
  this.sortedBreakpointsList = null; // sorted and synced with breakpointLines
  this.hoverBreakpoints = null;      // set of breakpoints because we're HOVERING over a given line

  this.enableTransitions = false; // EXPERIMENTAL - enable transition effects


  this.hasRendered = false;

  this.render(); // go for it!
}


// create a unique ID, which is often necessary so that jsPlumb doesn't get confused
// due to multiple ExecutionVisualizer instances being displayed simultaneously
ExecutionVisualizer.prototype.generateID = function(original_id) {
  // (it's safer to start names with a letter rather than a number)
  return 'v' + this.visualizerID + '__' + original_id;
}


ExecutionVisualizer.prototype.render = function() {
  if (this.hasRendered) {
    alert('ERROR: You should only call render() ONCE on an ExecutionVisualizer object.');
    return;
  }


  var myViz = this; // to prevent confusion of 'this' inside of nested functions

  // TODO: make less gross!
  this.domRoot.html(
  '<table border="0" class="visualizer">\
    <tr>\
      <td valign="top" id="left_pane">\
        <center>\
          <div id="pyCodeOutputDiv"/>\
          <div id="editCodeLinkDiv">\
            <a id="editBtn">Edit code</a>\
          </div>\
          <div id="executionSliderCaption">\
            Click here to focus and then use the left and right arrow keys to<br/>\
            step through execution. Click on lines of code to set/unset breakpoints.\
          </div>\
          <div id="executionSlider"/>\
          <div id="executionSliderFooter"/>\
          <div id="vcrControls">\
            <button id="jmpFirstInstr", type="button">&lt;&lt; First</button>\
            <button id="jmpStepBack", type="button">&lt; Back</button>\
            <span id="curInstr">Step ? of ?</span>\
            <button id="jmpStepFwd", type="button">Forward &gt;</button>\
            <button id="jmpLastInstr", type="button">Last &gt;&gt;</button>\
          </div>\
          <div id="errorOutput"/>\
        </center>\
        <div id="progOutputs">\
        Program output:<br/>\
        <textarea id="pyStdout" cols="50" rows="13" wrap="off" readonly></textarea>\
        </div>\
      </td>\
      <td valign="top">\
        <div id="dataViz">\
          <table id="stackHeapTable">\
            <tr>\
              <td id="stack_td">\
                <div id="globals_area">\
                  <div id="stackHeader">Frames</div>\
                </div>\
                <div id="stack">\
                </div>\
              </td>\
              <td id="heap_td">\
                <div id="heap">\
                  <div id="heapHeader">Objects</div>\
                </div>\
              </td>\
            </tr>\
          </table>\
        </div>\
      </td>\
    </tr>\
  </table>');


  if (this.params.editCodeBaseURL) {
    var urlStr = $.param.fragment(this.params.editCodeBaseURL,
                                  {code: this.curInputCode},
                                  2);
    this.domRoot.find('#editBtn').attr('href', urlStr);
  }
  else {
    this.domRoot.find('#editBtn').attr('href', "#");
    this.domRoot.find('#editBtn').click(function(){return false;}); // DISABLE the link!
  }


  // create a persistent globals frame
  // (note that we need to keep #globals_area separate from #stack for d3 to work its magic)
  this.domRoot.find("#globals_area").append('<div class="stackFrame" id="'
    + myViz.generateID('globals') + '"><div id="' + myViz.generateID('globals_header')
    + '" class="stackFrameHeader">Global variables</div><table class="stackFrameVarTable" id="'
    + myViz.generateID('global_table') + '"></table></div>');


  if (this.params && this.params.codeDivHeight) {
    this.domRoot.find('#pyCodeOutputDiv').css('max-height', this.params.codeDivHeight);
  }


  if (this.params && this.params.hideOutput) {
    this.domRoot.find('#progOutputs').hide();
  }

  this.domRoot.find("#jmpFirstInstr").click(function() {
    myViz.curInstr = 0;
    myViz.updateOutput();
  });

  this.domRoot.find("#jmpLastInstr").click(function() {
    myViz.curInstr = myViz.curTrace.length - 1;
    myViz.updateOutput();
  });

  this.domRoot.find("#jmpStepBack").click(function() {
    myViz.stepBack();
  });

  this.domRoot.find("#jmpStepFwd").click(function() {
    myViz.stepForward();
  });

  // disable controls initially ...
  this.domRoot.find("#vcrControls #jmpFirstInstr").attr("disabled", true);
  this.domRoot.find("#vcrControls #jmpStepBack").attr("disabled", true);
  this.domRoot.find("#vcrControls #jmpStepFwd").attr("disabled", true);
  this.domRoot.find("#vcrControls #jmpLastInstr").attr("disabled", true);



  // must postprocess curTrace prior to running precomputeCurTraceLayouts() ...
  var lastEntry = this.curTrace[this.curTrace.length - 1];

  this.instrLimitReached = (lastEntry.event == 'instruction_limit_reached');

  if (this.instrLimitReached) {
    this.curTrace.pop() // kill last entry
    var warningMsg = lastEntry.exception_msg;
    myViz.domRoot.find("#errorOutput").html(htmlspecialchars(warningMsg));
    myViz.domRoot.find("#errorOutput").show();
  }
  // as imran suggests, for a (non-error) one-liner, SNIP off the
  // first instruction so that we start after the FIRST instruction
  // has been executed ...
  else if (this.curTrace.length == 2) {
    this.curTrace.shift();
  }

  // set up slider after postprocessing curTrace

  var sliderDiv = this.domRoot.find('#executionSlider');
  sliderDiv.slider({min: 0, max: this.curTrace.length - 1, step: 1});
  //disable keyboard actions on the slider itself (to prevent double-firing of events)
  sliderDiv.find(".ui-slider-handle").unbind('keydown');
  // make skinnier and taller
  sliderDiv.find(".ui-slider-handle").css('width', '0.8em');
  sliderDiv.find(".ui-slider-handle").css('height', '1.4em');
  this.domRoot.find(".ui-widget-content").css('font-size', '0.9em');

  this.domRoot.find('#executionSlider').bind('slide', function(evt, ui) {
    // this is SUPER subtle. if this value was changed programmatically,
    // then evt.originalEvent will be undefined. however, if this value
    // was changed by a user-initiated event, then this code should be
    // executed ...
    if (evt.originalEvent) {
      myViz.curInstr = ui.value;
      myViz.updateOutput();
    }
  });


  if (this.params && this.params.startingInstruction) {
    assert(0 <= this.params.startingInstruction &&
           this.params.startingInstruction < this.curTrace.length);
    this.curInstr = this.params.startingInstruction;
  }

  if (this.params.jumpToEnd) {
    this.curInstr = this.curTrace.length - 1;
  }


  this.setKeyboardBindings();

  this.precomputeCurTraceLayouts();

  this.renderPyCodeOutput();

  this.updateOutput();

  this.hasRendered = true;
};


// find the previous/next breakpoint to c or return -1 if it doesn't exist
ExecutionVisualizer.prototype.findPrevBreakpoint = function() {
  var myViz = this;
  var c = myViz.curInstr;

  if (myViz.sortedBreakpointsList.length == 0) {
    return -1;
  }
  else {
    for (var i = 1; i < myViz.sortedBreakpointsList.length; i++) {
      var prev = myViz.sortedBreakpointsList[i-1];
      var cur = myViz.sortedBreakpointsList[i];
      if (c <= prev)
        return -1;
      if (cur >= c)
        return prev;
    }

    // final edge case:
    var lastElt = myViz.sortedBreakpointsList[myViz.sortedBreakpointsList.length - 1];
    return (lastElt < c) ? lastElt : -1;
  }
}

ExecutionVisualizer.prototype.findNextBreakpoint = function() {
  var myViz = this;
  var c = myViz.curInstr;

  if (myViz.sortedBreakpointsList.length == 0) {
    return -1;
  }
  // usability hack: if you're currently on a breakpoint, then
  // single-step forward to the next execution point, NOT the next
  // breakpoint. it's often useful to see what happens when the line
  // at a breakpoint executes.
  else if ($.inArray(c, myViz.sortedBreakpointsList) >= 0) {
    return c + 1;
  }
  else {
    for (var i = 0; i < myViz.sortedBreakpointsList.length - 1; i++) {
      var cur = myViz.sortedBreakpointsList[i];
      var next = myViz.sortedBreakpointsList[i+1];
      if (c < cur)
        return cur;
      if (cur <= c && c < next) // subtle
        return next;
    }

    // final edge case:
    var lastElt = myViz.sortedBreakpointsList[myViz.sortedBreakpointsList.length - 1];
    return (lastElt > c) ? lastElt : -1;
  }
}


// returns true if action successfully taken
ExecutionVisualizer.prototype.stepForward = function() {
  var myViz = this;

  if (myViz.curInstr < myViz.curTrace.length - 1) {
    // if there is a next breakpoint, then jump to it ...
    if (myViz.sortedBreakpointsList.length > 0) {
      var nextBreakpoint = myViz.findNextBreakpoint();
      if (nextBreakpoint != -1)
        myViz.curInstr = nextBreakpoint;
      else
        myViz.curInstr += 1; // prevent "getting stuck" on a solitary breakpoint
    }
    else {
      myViz.curInstr += 1;
    }
    myViz.updateOutput();
    return true;
  }

  return false;
}

// returns true if action successfully taken
ExecutionVisualizer.prototype.stepBack = function() {
  var myViz = this;

  if (myViz.curInstr > 0) {
    // if there is a prev breakpoint, then jump to it ...
    if (myViz.sortedBreakpointsList.length > 0) {
      var prevBreakpoint = myViz.findPrevBreakpoint();
      if (prevBreakpoint != -1)
        myViz.curInstr = prevBreakpoint;
      else
        myViz.curInstr -= 1; // prevent "getting stuck" on a solitary breakpoint
    }
    else {
      myViz.curInstr -= 1;
    }
    myViz.updateOutput();
    return true;
  }

  return false;
}

ExecutionVisualizer.prototype.setKeyboardBindings = function() {
  var myViz = this; // to prevent confusion of 'this' inside of nested functions


  // Set keyboard event listeners for td#left_pane. Note that it must
  // have a 'tabindex="0"' attribute set before it can receive focus and
  // thus receive keyboard events. Set it here:
  var leftTablePane = this.domRoot.find('td#left_pane');

  leftTablePane.attr('tabindex', '0');
  leftTablePane.css('outline', 'none'); // don't display a tacky border when focused
 
  leftTablePane.keydown(function(k) {
    if (!myViz.keyStuckDown) {
      if (k.keyCode == 37) { // left arrow
        if (myViz.stepBack()) {
          k.preventDefault(); // don't horizontally scroll the display
          myViz.keyStuckDown = true;
        }
      }
      else if (k.keyCode == 39) { // right arrow
        if (myViz.stepForward()) {
          k.preventDefault(); // don't horizontally scroll the display
          myViz.keyStuckDown = true;
        }
      }
    }
  });

  leftTablePane.keyup(function(k) {
    myViz.keyStuckDown = false;
  });
}


ExecutionVisualizer.prototype.grabKeyboardFocus = function() {
  this.domRoot.find('td#left_pane').focus();
}


ExecutionVisualizer.prototype.renderPyCodeOutput = function() {
  var myViz = this; // to prevent confusion of 'this' inside of nested functions


  // initialize!
  this.breakpoints = d3.map();
  this.sortedBreakpointsList = [];
  this.hoverBreakpoints = d3.map();

  // an array of objects with the following fields:
  //   'text' - the text of the line of code
  //   'lineNumber' - one-indexed (always the array index + 1)
  //   'executionPoints' - an ordered array of zero-indexed execution points where this line was executed
  //   'backgroundColor' - current code output line background color
  //   'breakpointHere' - has a breakpoint been set here?
  this.codeOutputLines = [];


  function renderSliderBreakpoints() {
    myViz.domRoot.find("#executionSliderFooter").empty();

    // I originally didn't want to delete and re-create this overlay every time,
    // but if I don't do so, there are weird flickering artifacts with clearing
    // the SVG container; so it's best to just delete and re-create the container each time
    var sliderOverlay = myViz.domRootD3.select('#executionSliderFooter')
      .append('svg')
      .attr('id', 'sliderOverlay')
      .attr('width', myViz.domRoot.find('#executionSlider').width())
      .attr('height', 12);

    var xrange = d3.scale.linear()
      .domain([0, myViz.curTrace.length - 1])
      .range([0, myViz.domRoot.find('#executionSlider').width()]);

    sliderOverlay.selectAll('rect')
      .data(myViz.sortedBreakpointsList)
      .enter().append('rect')
      .attr('x', function(d, i) {
        // make the edge cases look decent
        if (d == 0) {
          return 0;
        }
        else {
          return xrange(d) - 3;
        }
      })
      .attr('y', 0)
      .attr('width', 2)
      .attr('height', 12)
      .style('fill', function(d) {
         if (myViz.hoverBreakpoints.has(d)) {
           return hoverBreakpointColor;
         }
         else {
           return breakpointColor;
         }
      });
  }

  function _getSortedBreakpointsList() {
    var ret = [];
    myViz.breakpoints.forEach(function(k, v) {
      ret.push(Number(k)); // these should be NUMBERS, not strings
    });
    ret.sort(function(x,y){return x-y}); // WTF, javascript sort is lexicographic by default!
    return ret;
  }

  function addToBreakpoints(executionPoints) {
    $.each(executionPoints, function(i, ep) {
      myViz.breakpoints.set(ep, 1);
    });
    myViz.sortedBreakpointsList = _getSortedBreakpointsList();
  }

  function removeFromBreakpoints(executionPoints) {
    $.each(executionPoints, function(i, ep) {
      myViz.breakpoints.remove(ep);
    });
    myViz.sortedBreakpointsList = _getSortedBreakpointsList();
  }


  function setHoverBreakpoint(t) {
    var exePts = d3.select(t).datum().executionPoints;

    // don't do anything if exePts is empty
    // (i.e., this line was never executed)
    if (!exePts || exePts.length == 0) {
      return;
    }

    myViz.hoverBreakpoints = d3.map();
    $.each(exePts, function(i, ep) {
      // don't add redundant entries
      if (!myViz.breakpoints.has(ep)) {
        myViz.hoverBreakpoints.set(ep, 1);
      }
    });

    addToBreakpoints(exePts);
    renderSliderBreakpoints();
  }


  function setBreakpoint(t) {
    var exePts = d3.select(t).datum().executionPoints;

    // don't do anything if exePts is empty
    // (i.e., this line was never executed)
    if (!exePts || exePts.length == 0) {
      return;
    }

    addToBreakpoints(exePts);

    // remove from hoverBreakpoints so that slider display immediately changes color
    $.each(exePts, function(i, ep) {
      myViz.hoverBreakpoints.remove(ep);
    });

    d3.select(t.parentNode).select('td.lineNo').style('color', breakpointColor);
    d3.select(t.parentNode).select('td.lineNo').style('font-weight', 'bold');

    renderSliderBreakpoints();
  }

  function unsetBreakpoint(t) {
    var exePts = d3.select(t).datum().executionPoints;

    // don't do anything if exePts is empty
    // (i.e., this line was never executed)
    if (!exePts || exePts.length == 0) {
      return;
    }

    removeFromBreakpoints(exePts);

    var lineNo = d3.select(t).datum().lineNumber;

    if (myViz.visitedLinesSet.has(lineNo)) {
      d3.select(t.parentNode).select('td.lineNo').style('color', visitedLineColor);
      d3.select(t.parentNode).select('td.lineNo').style('font-weight', 'bold');
    }
    else {
      d3.select(t.parentNode).select('td.lineNo').style('color', '');
      d3.select(t.parentNode).select('td.lineNo').style('font-weight', '');
    }

    renderSliderBreakpoints();
  }

  var lines = this.curInputCode.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var cod = lines[i];

    var n = {};
    n.text = cod;
    n.lineNumber = i + 1;
    n.executionPoints = [];
    n.backgroundColor = null;
    n.breakpointHere = false;

    $.each(this.curTrace, function(j, elt) {
      if (elt.line == n.lineNumber) {
        n.executionPoints.push(j);
      }
    });

 
    // if there is a comment containing 'breakpoint' and this line was actually executed,
    // then set a breakpoint on this line
    var breakpointInComment = false;
    var toks = cod.split('#');
    for (var j = 1 /* start at index 1, not 0 */; j < toks.length; j++) {
      if (toks[j].indexOf('breakpoint') != -1) {
        breakpointInComment = true;
      }
    }

    if (breakpointInComment && n.executionPoints.length > 0) {
      n.breakpointHere = true;
      addToBreakpoints(n.executionPoints);
    }

    this.codeOutputLines.push(n);
  }


  myViz.domRoot.find('#pyCodeOutputDiv').empty();

  // maps this.codeOutputLines to both table columns
  this.domRootD3.select('#pyCodeOutputDiv')
    .append('table')
    .attr('id', 'pyCodeOutput')
    .selectAll('tr')
    .data(this.codeOutputLines)
    .enter().append('tr')
    .selectAll('td')
    .data(function(d, i){return [d, d] /* map full data item down both columns */;})
    .enter().append('td')
    .attr('class', function(d, i) {return (i == 0) ? 'lineNo' : 'cod';})
    .style('cursor', function(d, i) {return 'pointer'})
    .html(function(d, i) {
      return (i == 0) ? d.lineNumber : htmlspecialchars(d.text);
    })
    .on('mouseover', function() {
      setHoverBreakpoint(this);
    })
    .on('mouseout', function() {
      myViz.hoverBreakpoints = d3.map();

      var breakpointHere = d3.select(this).datum().breakpointHere;

      if (!breakpointHere) {
        unsetBreakpoint(this);
      }

      renderSliderBreakpoints(); // get rid of hover breakpoint colors
    })
    .on('mousedown', function() {
      // don't do anything if exePts is empty
      // (i.e., this line was never executed)
      var exePts = d3.select(this).datum().executionPoints;
      if (!exePts || exePts.length == 0) {
        return;
      }

      // toggle breakpoint
      d3.select(this).datum().breakpointHere = !d3.select(this).datum().breakpointHere;

      var breakpointHere = d3.select(this).datum().breakpointHere;
      if (breakpointHere) {
        setBreakpoint(this);
      }
      else {
        unsetBreakpoint(this);
      }
    });


  renderSliderBreakpoints(); // renders breakpoints written in as code comments
}


// This function is called every time the display needs to be updated
ExecutionVisualizer.prototype.updateOutput = function() {
  var myViz = this; // to prevent confusion of 'this' inside of nested functions

  assert(this.curTrace);

  var curEntry = this.curTrace[this.curInstr];
  var hasError = false;

  // render VCR controls:
  var totalInstrs = this.curTrace.length;

  var isLastInstr = (this.curInstr == (totalInstrs-1));

  var vcrControls = myViz.domRoot.find("#vcrControls");

  // to be user-friendly, if we're on the LAST instruction, print "Program has terminated"
  // and DON'T highlight any lines of code in the code display
  if (isLastInstr) {
    if (this.instrLimitReached) {
      vcrControls.find("#curInstr").html("Instruction limit reached");
    }
    else {
      vcrControls.find("#curInstr").html("Program has terminated");
    }
  }
  else {
    vcrControls.find("#curInstr").html("About to run step " +
                                       String(this.curInstr + 1) +
                                       " of " + String(totalInstrs-1));
  }


  vcrControls.find("#jmpFirstInstr").attr("disabled", false);
  vcrControls.find("#jmpStepBack").attr("disabled", false);
  vcrControls.find("#jmpStepFwd").attr("disabled", false);
  vcrControls.find("#jmpLastInstr").attr("disabled", false);

  if (this.curInstr == 0) {
    vcrControls.find("#jmpFirstInstr").attr("disabled", true);
    vcrControls.find("#jmpStepBack").attr("disabled", true);
  }
  if (isLastInstr) {
    vcrControls.find("#jmpLastInstr").attr("disabled", true);
    vcrControls.find("#jmpStepFwd").attr("disabled", true);
  }


  // PROGRAMMATICALLY change the value, so evt.originalEvent should be undefined
  myViz.domRoot.find('#executionSlider').slider('value', this.curInstr);


  // render error (if applicable):
  if (curEntry.event == 'exception' ||
      curEntry.event == 'uncaught_exception') {
    assert(curEntry.exception_msg);

    if (curEntry.exception_msg == "Unknown error") {
      myViz.domRoot.find("#errorOutput").html('Unknown error: Please email a bug report to philip@pgbovine.net');
    }
    else {
      myViz.domRoot.find("#errorOutput").html(htmlspecialchars(curEntry.exception_msg));
    }

    myViz.domRoot.find("#errorOutput").show();

    hasError = true;
  }
  else {
    if (!this.instrLimitReached) { // ugly, I know :/
      myViz.domRoot.find("#errorOutput").hide();
    }
  }


  function highlightCodeLine() {
    /* if instrLimitReached, then treat like a normal non-terminating line */
    var isTerminated = (!myViz.instrLimitReached && isLastInstr);

    myViz.domRootD3.selectAll('#pyCodeOutputDiv td.lineNo')
      .attr('id', function(d) {return 'lineNo' + d.lineNumber;})
      .style('color', function(d)
        {return d.breakpointHere ? breakpointColor :
                                   (myViz.visitedLinesSet.has(d.lineNumber) ? visitedLineColor : null);
       })
      .style('font-weight', function(d)
        {return d.breakpointHere ? 'bold' :
                                   (myViz.visitedLinesSet.has(d.lineNumber) ? 'bold' : null);
       });


    myViz.domRootD3.selectAll('#pyCodeOutputDiv td.cod')
      .style('background-color', function(d) {
        if (d.lineNumber == curEntry.line) {
          d.backgroundColor = hasError ? errorColor :
                                         (isTerminated ?  terminatedLineColor : highlightedLineColor);
        }
        else {
          d.backgroundColor = null;
        }

        return d.backgroundColor;
      })
      .style('border-top', function(d) {
        if ((d.lineNumber == curEntry.line) && !hasError && !isTerminated) {
          return '1px solid ' + highlightedLineTopBorderColor;
        }
        else {
          // put a default white top border to keep space usage consistent
          return '1px solid #ffffff';
        }
      });


    // returns True iff lineNo is visible in pyCodeOutputDiv
    function isOutputLineVisible(lineNo) {
      var lineNoTd = myViz.domRoot.find('#lineNo' + lineNo);
      var LO = lineNoTd.offset().top;

      var codeOutputDiv = myViz.domRoot.find('#pyCodeOutputDiv');
      var PO = codeOutputDiv.offset().top;
      var ST = codeOutputDiv.scrollTop();
      var H = codeOutputDiv.height();

      // add a few pixels of fudge factor on the bottom end due to bottom scrollbar
      return (PO <= LO) && (LO < (PO + H - 15));
    }


    // smoothly scroll pyCodeOutputDiv so that the given line is at the center
    function scrollCodeOutputToLine(lineNo) {
      var lineNoTd = myViz.domRoot.find('#lineNo' + lineNo);
      var LO = lineNoTd.offset().top;

      var codeOutputDiv = myViz.domRoot.find('#pyCodeOutputDiv');
      var PO = codeOutputDiv.offset().top;
      var ST = codeOutputDiv.scrollTop();
      var H = codeOutputDiv.height();

      codeOutputDiv.stop(); // first stop all previously-queued animations
      codeOutputDiv.animate({scrollTop: (ST + (LO - PO - (Math.round(H / 2))))}, 300);
    }


    // smoothly scroll code display
    if (!isOutputLineVisible(curEntry.line)) {
      scrollCodeOutputToLine(curEntry.line);
    }
  }


  // calculate all lines that have been 'visited' (executed)
  // by execution up to (but NOT INCLUDING) this.curInstr:
  this.visitedLinesSet = d3.map();
  for (var i = 0; i < this.curInstr; i++) {
    if (this.curTrace[i].line) {
      this.visitedLinesSet.set(this.curTrace[i].line, 1);
    }
  }


  // render code output:
  if (curEntry.line) {
    highlightCodeLine();
  }


  // render stdout:

  // keep original horizontal scroll level:
  var oldLeft = myViz.domRoot.find("#pyStdout").scrollLeft();
  myViz.domRoot.find("#pyStdout").val(curEntry.stdout);

  myViz.domRoot.find("#pyStdout").scrollLeft(oldLeft);
  // scroll to bottom, though:
  myViz.domRoot.find("#pyStdout").scrollTop(myViz.domRoot.find("#pyStdout")[0].scrollHeight);


  // finally, render all of the data structures
  this.renderDataStructures();
}


// Pre-compute the layout of top-level heap objects for ALL execution
// points as soon as a trace is first loaded. The reason why we want to
// do this is so that when the user steps through execution points, the
// heap objects don't "jiggle around" (i.e., preserving positional
// invariance). Also, if we set up the layout objects properly, then we
// can take full advantage of d3 to perform rendering and transitions.

ExecutionVisualizer.prototype.precomputeCurTraceLayouts = function() {

  // curTraceLayouts is a list of top-level heap layout "objects" with the
  // same length as curTrace after it's been fully initialized. Each
  // element of curTraceLayouts is computed from the contents of its
  // immediate predecessor, thus ensuring that objects don't "jiggle
  // around" between consecutive execution points.
  //
  // Each top-level heap layout "object" is itself a LIST of LISTS of
  // object IDs, where each element of the outer list represents a row,
  // and each element of the inner list represents columns within a
  // particular row. Each row can have a different number of columns. Most
  // rows have exactly ONE column (representing ONE object ID), but rows
  // containing 1-D linked data structures have multiple columns. Each
  // inner list element looks something like ['row1', 3, 2, 1] where the
  // first element is a unique row ID tag, which is used as a key for d3 to
  // preserve "object constancy" for updates, transitions, etc. The row ID
  // is derived from the FIRST object ID inserted into the row. Since all
  // object IDs are unique, all row IDs will also be unique.

  /* This is a good, simple example to test whether objects "jiggle"

  x = [1, [2, [3, None]]]
  y = [4, [5, [6, None]]]

  x[1][1] = y[1]

  */
  this.curTraceLayouts = [];
  this.curTraceLayouts.push([]); // pre-seed with an empty sentinel to simplify the code

  assert(this.curTrace.length > 0);

  var myViz = this; // to prevent confusion of 'this' inside of nested functions

 
  $.each(this.curTrace, function(i, curEntry) {
    var prevLayout = myViz.curTraceLayouts[myViz.curTraceLayouts.length - 1];

    // make a DEEP COPY of prevLayout to use as the basis for curLine
    var curLayout = $.extend(true /* deep copy */ , [], prevLayout);

    // initialize with all IDs from curLayout
    var idsToRemove = d3.map();
    $.each(curLayout, function(i, row) {
      for (var j = 1 /* ignore row ID tag */; j < row.length; j++) {
        idsToRemove.set(row[j], 1);
      }
    });

    var idsAlreadyLaidOut = d3.map(); // to prevent infinite recursion


    function curLayoutIndexOf(id) {
      for (var i = 0; i < curLayout.length; i++) {
        var row = curLayout[i];
        var index = row.indexOf(id);
        if (index > 0) { // index of 0 is impossible since it's the row ID tag
          return {row: row, index: index}
        }
      }
      return null;
    }


    function recurseIntoObject(id, curRow, newRow) {

      // heuristic for laying out 1-D linked data structures: check for enclosing elements that are
      // structurally identical and then lay them out as siblings in the same "row"
      var heapObj = curEntry.heap[id];
      assert(heapObj);

      if (heapObj[0] == 'LIST' || heapObj[0] == 'TUPLE') {
        $.each(heapObj, function(ind, child) {
          if (ind < 1) return; // skip type tag

          if (!isPrimitiveType(child)) {
            var childID = getRefID(child);
            if (structurallyEquivalent(heapObj, curEntry.heap[childID])) {
              updateCurLayout(childID, curRow, newRow);
            }
          }
        });
      }
      else if (heapObj[0] == 'DICT') {
        $.each(heapObj, function(ind, child) {
          if (ind < 1) return; // skip type tag

          var dictVal = child[1];
          if (!isPrimitiveType(dictVal)) {
            var childID = getRefID(dictVal);
            if (structurallyEquivalent(heapObj, curEntry.heap[childID])) {
              updateCurLayout(childID, curRow, newRow);
            }
          }
        });
      }
      else if (heapObj[0] == 'INSTANCE') {
        jQuery.each(heapObj, function(ind, child) {
          if (ind < 2) return; // skip type tag and class name

          // instance keys are always strings, so no need to recurse
          assert(typeof child[0] == "string");

          var instVal = child[1];
          if (!isPrimitiveType(instVal)) {
            var childID = getRefID(instVal);
            if (structurallyEquivalent(heapObj, curEntry.heap[childID])) {
              updateCurLayout(childID, curRow, newRow);
            }
          }
        });
      }
    }


    // a krazy function!
    // id     - the new object ID to be inserted somewhere in curLayout
    //          (if it's not already in there)
    // curRow - a row within curLayout where new linked list
    //          elements can be appended onto (might be null)
    // newRow - a new row that might be spliced into curRow or appended
    //          as a new row in curLayout
    function updateCurLayout(id, curRow, newRow) {
      if (idsAlreadyLaidOut.has(id)) {
        return; // PUNT!
      }

      var curLayoutLoc = curLayoutIndexOf(id);

      var alreadyLaidOut = idsAlreadyLaidOut.has(id);
      idsAlreadyLaidOut.set(id, 1); // unconditionally set now

      // if id is already in curLayout ...
      if (curLayoutLoc) {
        var foundRow = curLayoutLoc.row;
        var foundIndex = curLayoutLoc.index;

        idsToRemove.remove(id); // this id is already accounted for!

        // very subtle ... if id hasn't already been handled in
        // this iteration, then splice newRow into foundRow. otherwise
        // (later) append newRow onto curLayout as a truly new row
        if (!alreadyLaidOut) {
          // splice the contents of newRow right BEFORE foundIndex.
          // (Think about when you're trying to insert in id=3 into ['row1', 2, 1]
          //  to represent a linked list 3->2->1. You want to splice the 3
          //  entry right before the 2 to form ['row1', 3, 2, 1])
          if (newRow.length > 1) {
            var args = [foundIndex, 0];
            for (var i = 1; i < newRow.length; i++) { // ignore row ID tag
              args.push(newRow[i]);
              idsToRemove.remove(newRow[i]);
            }
            foundRow.splice.apply(foundRow, args);

            // remove ALL elements from newRow since they've all been accounted for
            // (but don't reassign it away to an empty list, since the
            // CALLER checks its value. TODO: how to get rid of this gross hack?!?)
            newRow.splice(0, newRow.length);
          }
        }

        // recurse to find more top-level linked entries to append onto foundRow
        recurseIntoObject(id, foundRow, []);
      }
      else {
        // push id into newRow ...
        if (newRow.length == 0) {
          newRow.push('row' + id); // unique row ID (since IDs are unique)
        }
        newRow.push(id);

        // recurse to find more top-level linked entries ...
        recurseIntoObject(id, curRow, newRow);


        // if newRow hasn't been spliced into an existing row yet during
        // a child recursive call ...
        if (newRow.length > 0) {
          if (curRow && curRow.length > 0) {
            // append onto the END of curRow if it exists
            for (var i = 1; i < newRow.length; i++) { // ignore row ID tag
              curRow.push(newRow[i]);
            }
          }
          else {
            // otherwise push to curLayout as a new row
            //
            // TODO: this might not always look the best, since we might
            // sometimes want to splice newRow in the MIDDLE of
            // curLayout. Consider this example:
            //
            // x = [1,2,3]
            // y = [4,5,6]
            // x = [7,8,9]
            //
            // when the third line is executed, the arrows for x and y
            // will be crossed (ugly!) since the new row for the [7,8,9]
            // object is pushed to the end (bottom) of curLayout. The
            // proper behavior is to push it to the beginning of
            // curLayout where the old row for 'x' used to be.
            curLayout.push($.extend(true /* make a deep copy */ , [], newRow));
          }

          // regardless, newRow is now accounted for, so clear it
          for (var i = 1; i < newRow.length; i++) { // ignore row ID tag
            idsToRemove.remove(newRow[i]);
          }
          newRow.splice(0, newRow.length); // kill it!
        }

      }
    }


    // iterate through all globals and ordered stack frames and call updateCurLayout
    $.each(curEntry.ordered_globals, function(i, varname) {
      var val = curEntry.globals[varname];
      if (val !== undefined) { // might not be defined at this line, which is OKAY!
        if (!isPrimitiveType(val)) {
          var id = getRefID(val);
          updateCurLayout(id, null, []);
        }
      }
    });

    $.each(curEntry.stack_to_render, function(i, frame) {
      $.each(frame.ordered_varnames, function(xxx, varname) {
        var val = frame.encoded_locals[varname];

        if (!isPrimitiveType(val)) {
          var id = getRefID(val);
          updateCurLayout(id, null, []);
        }
      });
    });


    // iterate through remaining elements of idsToRemove and REMOVE them from curLayout
    idsToRemove.forEach(function(id, xxx) {
      id = Number(id); // keys are stored as strings, so convert!!!
      $.each(curLayout, function(rownum, row) {
        var ind = row.indexOf(id);
        if (ind > 0) { // remember that index 0 of the row is the row ID tag
          row.splice(ind, 1);
        }
      });
    });

    // now remove empty rows (i.e., those with only a row ID tag) from curLayout
    curLayout = curLayout.filter(function(row) {return row.length > 1});

    myViz.curTraceLayouts.push(curLayout);
  });

  this.curTraceLayouts.splice(0, 1); // remove seeded empty sentinel element
  assert (this.curTrace.length == this.curTraceLayouts.length);
}


var heapPtrSrcRE = /__heap_pointer_src_/;

// The "3.0" version of renderDataStructures renders variables in
// a stack, values in a separate heap, and draws line connectors
// to represent both stack->heap object references and, more importantly,
// heap->heap references. This version was created in August 2012.
//
// The "2.0" version of renderDataStructures renders variables in
// a stack and values in a separate heap, with data structure aliasing
// explicitly represented via line connectors (thanks to jsPlumb lib).
// This version was created in September 2011.
//
// The ORIGINAL "1.0" version of renderDataStructures
// was created in January 2010 and rendered variables and values
// INLINE within each stack frame without any explicit representation
// of data structure aliasing. That is, aliased objects were rendered
// multiple times, and a unique ID label was used to identify aliases.
ExecutionVisualizer.prototype.renderDataStructures = function() {

  var myViz = this; // to prevent confusion of 'this' inside of nested functions

  var curEntry = this.curTrace[this.curInstr];
  var curToplevelLayout = this.curTraceLayouts[this.curInstr];


  // Heap object rendering phase:


  // This is VERY crude, but to prevent multiple redundant HEAP->HEAP
  // connectors from being drawn with the same source and origin, we need to first
  // DELETE ALL existing HEAP->HEAP connections, and then re-render all of
  // them in each call to this function. The reason why we can't safely
  // hold onto them is because there's no way to guarantee that the
  // *__heap_pointer_src_<src id> IDs are consistent across execution points.
  myViz.jsPlumbInstance.select().each(function(c) {
    if (c.sourceId.match(heapPtrSrcRE)) {
      myViz.jsPlumbInstance.detachAllConnections(c.sourceId);
    }
  });


  // Key:   CSS ID of the div element representing the stack frame variable
  //        (for stack->heap connections) or heap object (for heap->heap connections)
  //        the format is: '<this.visualizerID>__heap_pointer_src_<src id>'
  // Value: CSS ID of the div element representing the value rendered in the heap
  //        (the format is: '<this.visualizerID>__heap_object_<id>')
  //
  // The reason we need to prepend this.visualizerID is because jsPlumb needs
  // GLOBALLY UNIQUE IDs for use as connector endpoints.

  // the only elements in these sets are NEW elements to be rendered in this
  // particular call to renderDataStructures.
  var connectionEndpointIDs = d3.map();
  var heapConnectionEndpointIDs = d3.map(); // subset of connectionEndpointIDs for heap->heap connections

  var heap_pointer_src_id = 1; // increment this to be unique for each heap_pointer_src_*


  var renderedObjectIDs = d3.map();

  // count everything in curToplevelLayout as already rendered since we will render them
  // in d3 .each() statements
  $.each(curToplevelLayout, function(xxx, row) {
    for (var i = 0; i < row.length; i++) {
      renderedObjectIDs.set(row[i], 1);
    }
  });



  // use d3 to render the heap by mapping curToplevelLayout into <table class="heapRow">
  // and <td class="toplevelHeapObject"> elements

  var heapRows = myViz.domRootD3.select('#heap')
    .selectAll('table.heapRow')
    .data(curToplevelLayout, function(objLst) {
      return objLst[0]; // return first element, which is the row ID tag
  });


  // insert new heap rows
  heapRows.enter().append('table')
    //.each(function(objLst, i) {console.log('NEW ROW:', objLst, i);})
    .attr('class', 'heapRow');

  // delete a heap row
  var hrExit = heapRows.exit();

  if (myViz.enableTransitions) {
    hrExit
      .style('opacity', '1')
      .transition()
      .style('opacity', '0')
      .duration(500)
      .each('end', function() {
        hrExit.remove();
        myViz.redrawConnectors();
      });
  }
  else {
    hrExit.remove();
  }


  // update an existing heap row
  var toplevelHeapObjects = heapRows
    //.each(function(objLst, i) { console.log('UPDATE ROW:', objLst, i); })
    .selectAll('td.toplevelHeapObject')
    .data(function(d, i) {return d.slice(1, d.length);}, /* map over each row, skipping row ID tag */
          function(objID) {return objID;} /* each object ID is unique for constancy */);

  // insert a new toplevelHeapObject
  var tlhEnter = toplevelHeapObjects.enter().append('td')
    .attr('class', 'toplevelHeapObject')
    .attr('id', function(d, i) {return 'toplevel_heap_object_' + d;});

  if (myViz.enableTransitions) {
    tlhEnter
      .style('opacity', '0')
      .style('border-color', 'red')
      .transition()
      .style('opacity', '1') /* fade in */
      .duration(700)
      .each('end', function() {
        tlhEnter.transition()
          .style('border-color', 'white') /* kill border */
          .duration(300)
        });
  }

  // remember that the enter selection is added to the update
  // selection so that we can process it later ...

  // update a toplevelHeapObject
  toplevelHeapObjects
    .order() // VERY IMPORTANT to put in the order corresponding to data elements
    .each(function(objID, i) {
      //console.log('NEW/UPDATE ELT', objID);

      // TODO: add a smoother transition in the future
      // Right now, just delete the old element and render a new one in its place
      $(this).empty();
      renderCompoundObject(objID, $(this), true);
    });

  // delete a toplevelHeapObject
  var tlhExit = toplevelHeapObjects.exit();

  if (myViz.enableTransitions) {
    tlhExit.transition()
      .style('opacity', '0') /* fade out */
      .duration(500)
      .each('end', function() {
        tlhExit.remove();
        myViz.redrawConnectors();
      });
  }
  else {
    tlhExit.remove();
  }


  function renderNestedObject(obj, d3DomElement) {
    if (isPrimitiveType(obj)) {
      renderPrimitiveObject(obj, d3DomElement);
    }
    else {
      renderCompoundObject(getRefID(obj), d3DomElement, false);
    }
  }


  function renderPrimitiveObject(obj, d3DomElement) {
    var typ = typeof obj;

    if (obj == null) {
      d3DomElement.append('<span class="nullObj">None</span>');
    }
    else if (typ == "number") {
      d3DomElement.append('<span class="numberObj">' + obj + '</span>');
    }
    else if (typ == "boolean") {
      if (obj) {
        d3DomElement.append('<span class="boolObj">True</span>');
      }
      else {
        d3DomElement.append('<span class="boolObj">False</span>');
      }
    }
    else if (typ == "string") {
      // escape using htmlspecialchars to prevent HTML/script injection
      var literalStr = htmlspecialchars(obj);

      // print as a double-quoted string literal
      literalStr = literalStr.replace(new RegExp('\"', 'g'), '\\"'); // replace ALL
      literalStr = '"' + literalStr + '"';

      d3DomElement.append('<span class="stringObj">' + literalStr + '</span>');
    }
    else {
      assert(false);
    }
  }


  function renderCompoundObject(objID, d3DomElement, isTopLevel) {
    if (!isTopLevel && renderedObjectIDs.has(objID)) {
      // render jsPlumb arrow source since this heap object has already been rendered
      // (or will be rendered soon)

      // add a stub so that we can connect it with a connector later.
      // IE needs this div to be NON-EMPTY in order to properly
      // render jsPlumb endpoints, so that's why we add an "&nbsp;"!

      var srcDivID = myViz.generateID('heap_pointer_src_' + heap_pointer_src_id);
      heap_pointer_src_id++; // just make sure each source has a UNIQUE ID
      d3DomElement.append('<div id="' + srcDivID + '">&nbsp;</div>');

      var dstDivID = myViz.generateID('heap_object_' + objID);

      assert(!connectionEndpointIDs.has(srcDivID));
      connectionEndpointIDs.set(srcDivID, dstDivID);
      //console.log('HEAP->HEAP', srcDivID, dstDivID);

      assert(!heapConnectionEndpointIDs.has(srcDivID));
      heapConnectionEndpointIDs.set(srcDivID, dstDivID);

      return; // early return!
    }


    var heapObjID = myViz.generateID('heap_object_' + objID);


    // wrap ALL compound objects in a heapObject div so that jsPlumb
    // connectors can point to it:
    d3DomElement.append('<div class="heapObject" id="' + heapObjID + '"></div>');
    d3DomElement = myViz.domRoot.find('#' + heapObjID);


    renderedObjectIDs.set(objID, 1);

    var obj = curEntry.heap[objID];
    assert($.isArray(obj));


    if (obj[0] == 'LIST' || obj[0] == 'TUPLE' || obj[0] == 'SET' || obj[0] == 'DICT') {
      var label = obj[0].toLowerCase();

      assert(obj.length >= 1);
      if (obj.length == 1) {
        d3DomElement.append('<div class="typeLabel">empty ' + label + '</div>');
      }
      else {
        d3DomElement.append('<div class="typeLabel">' + label + '</div>');
        d3DomElement.append('<table class="' + label + 'Tbl"></table>');
        var tbl = d3DomElement.children('table');

        if (obj[0] == 'LIST' || obj[0] == 'TUPLE') {
          tbl.append('<tr></tr><tr></tr>');
          var headerTr = tbl.find('tr:first');
          var contentTr = tbl.find('tr:last');
          $.each(obj, function(ind, val) {
            if (ind < 1) return; // skip type tag and ID entry

            // add a new column and then pass in that newly-added column
            // as d3DomElement to the recursive call to child:
            headerTr.append('<td class="' + label + 'Header"></td>');
            headerTr.find('td:last').append(ind - 1);

            contentTr.append('<td class="'+ label + 'Elt"></td>');
            renderNestedObject(val, contentTr.find('td:last'));
          });
        }
        else if (obj[0] == 'SET') {
          // create an R x C matrix:
          var numElts = obj.length - 1;

          // gives roughly a 3x5 rectangular ratio, square is too, err,
          // 'square' and boring
          var numRows = Math.round(Math.sqrt(numElts));
          if (numRows > 3) {
            numRows -= 1;
          }

          var numCols = Math.round(numElts / numRows);
          // round up if not a perfect multiple:
          if (numElts % numRows) {
            numCols += 1;
          }

          jQuery.each(obj, function(ind, val) {
            if (ind < 1) return; // skip 'SET' tag

            if (((ind - 1) % numCols) == 0) {
              tbl.append('<tr></tr>');
            }

            var curTr = tbl.find('tr:last');
            curTr.append('<td class="setElt"></td>');
            renderNestedObject(val, curTr.find('td:last'));
          });
        }
        else if (obj[0] == 'DICT') {
          $.each(obj, function(ind, kvPair) {
            if (ind < 1) return; // skip 'DICT' tag

            tbl.append('<tr class="dictEntry"><td class="dictKey"></td><td class="dictVal"></td></tr>');
            var newRow = tbl.find('tr:last');
            var keyTd = newRow.find('td:first');
            var valTd = newRow.find('td:last');

            var key = kvPair[0];
            var val = kvPair[1];

            renderNestedObject(key, keyTd);
            renderNestedObject(val, valTd);
          });
        }
      }
    }
    else if (obj[0] == 'INSTANCE' || obj[0] == 'CLASS') {
      var isInstance = (obj[0] == 'INSTANCE');
      var headerLength = isInstance ? 2 : 3;

      assert(obj.length >= headerLength);

      if (isInstance) {
        d3DomElement.append('<div class="typeLabel">' + obj[1] + ' instance</div>');
      }
      else {
        var superclassStr = '';
        if (obj[2].length > 0) {
          superclassStr += ('[extends ' + obj[2].join(', ') + '] ');
        }
        d3DomElement.append('<div class="typeLabel">' + obj[1] + ' class ' + superclassStr + '</div>');
      }

      if (obj.length > headerLength) {
        var lab = isInstance ? 'inst' : 'class';
        d3DomElement.append('<table class="' + lab + 'Tbl"></table>');

        var tbl = d3DomElement.children('table');

        $.each(obj, function(ind, kvPair) {
          if (ind < headerLength) return; // skip header tags

          tbl.append('<tr class="' + lab + 'Entry"><td class="' + lab + 'Key"></td><td class="' + lab + 'Val"></td></tr>');

          var newRow = tbl.find('tr:last');
          var keyTd = newRow.find('td:first');
          var valTd = newRow.find('td:last');

          // the keys should always be strings, so render them directly (and without quotes):
          assert(typeof kvPair[0] == "string");
          var attrnameStr = htmlspecialchars(kvPair[0]);
          keyTd.append('<span class="keyObj">' + attrnameStr + '</span>');

          // values can be arbitrary objects, so recurse:
          renderNestedObject(kvPair[1], valTd);
        });
      }
    }
    else if (obj[0] == 'FUNCTION') {
      assert(obj.length == 3);

      // pretty-print lambdas and display other weird characters:
      var funcName = htmlspecialchars(obj[1]).replace('&lt;lambda&gt;', 'λ');
      var parentFrameID = obj[2]; // optional

      if (parentFrameID) {
        d3DomElement.append('<div class="funcObj">function ' + funcName + ' [parent=f'+ parentFrameID + ']</div>');
      }
      else {
        d3DomElement.append('<div class="funcObj">function ' + funcName + '</div>');
      }
    }
    else {
      // render custom data type
      assert(obj.length == 2);

      var typeName = obj[0];
      var strRepr = obj[1];

      strRepr = htmlspecialchars(strRepr); // escape strings!

      d3DomElement.append('<div class="typeLabel">' + typeName + '</div>');
      d3DomElement.append('<table class="customObjTbl"><tr><td class="customObjElt">' + strRepr + '</td></tr></table>');
    }
  }


  // Render globals and then stack frames using d3:


  function highlightAliasedConnectors(d, i) {
    // if this row contains a stack pointer, then highlight its arrow and
    // ALL aliases that also point to the same heap object
    var stackPtrId = $(this).find('div.stack_pointer').attr('id');
    if (stackPtrId) {
      var foundTargetId = null;
      myViz.jsPlumbInstance.select({source: stackPtrId}).each(function(c) {foundTargetId = c.targetId;});

      // use foundTargetId to highlight ALL ALIASES
      myViz.jsPlumbInstance.select().each(function(c) {
        if (c.targetId == foundTargetId) {
          c.setHover(true);
          $(c.canvas).css("z-index", 2000); // ... and move it to the VERY FRONT
        }
        else {
          c.setHover(false);
        }
      });
    }
  }

  function unhighlightAllConnectors(d, i) {
    myViz.jsPlumbInstance.select().each(function(c) {
      c.setHover(false);
    });
  }



  // render all global variables IN THE ORDER they were created by the program,
  // in order to ensure continuity:

  // Derive a list where each element contains a pair of
  // [varname, value] as long as value is NOT undefined.
  // (Sometimes entries in curEntry.ordered_globals are undefined,
  // so filter those out.)
  var realGlobalsLst = [];
  $.each(curEntry.ordered_globals, function(i, varname) {
    var val = curEntry.globals[varname];

    // (use '!==' to do an EXACT match against undefined)
    if (val !== undefined) { // might not be defined at this line, which is OKAY!
      realGlobalsLst.push([varname, varname]); /* purposely map varname down both columns */
    }
  });

  var globalsID = myViz.generateID('globals');
  var globalTblID = myViz.generateID('global_table');

  var globalsD3 = myViz.domRootD3.select('#' + globalTblID)
    .selectAll('tr')
    .data(realGlobalsLst, function(d) {
      return d[0]; // use variable name as key
    });
    

  // ENTER
  globalsD3.enter()
    .append('tr')
    .on('mouseover', highlightAliasedConnectors)
    .on('mouseout',  unhighlightAllConnectors)
    .selectAll('td.stackFrameVar,td.stackFrameValue')
    .data(function(d, i){return d;}) /* map varname down both columns */
    .enter()
    .append('td')
    .attr('class', function(d, i) {return (i == 0) ? 'stackFrameVar' : 'stackFrameValue';})
    .html(function(d, i) {
      return (i == 0) ? d : '' /* initialize in each() later */;
    })
  // remember that the enter selection is added to the update
  // selection so that we can process it later ...

  // UPDATE
  globalsD3
    .order() // VERY IMPORTANT to put in the order corresponding to data elements
    .selectAll('td')
    .data(function(d, i){return d;}) /* map varname down both columns */
    .each(function(varname, i) {
      if (i == 1) {
        var val = curEntry.globals[varname];

        // include type in repr to prevent conflating integer 5 with string "5"
        var valStringRepr = String(typeof val) + ':' + String(val);

        // SUPER HACK - retrieve previous value as a hidden attribute
        var prevValStringRepr = $(this).attr('data-curvalue');

        // IMPORTANT! only clear the div and render a new element if the
        // value has changed
        if (valStringRepr != prevValStringRepr) {
          // TODO: render a transition

          $(this).empty(); // crude but effective for now

          if (isPrimitiveType(val)) {
            renderPrimitiveObject(val, $(this));
          }
          else {
            // add a stub so that we can connect it with a connector later.
            // IE needs this div to be NON-EMPTY in order to properly
            // render jsPlumb endpoints, so that's why we add an "&nbsp;"!

            // make sure varname doesn't contain any weird
            // characters that are illegal for CSS ID's ...
            var varDivID = myViz.generateID('global__' + varnameToCssID(varname));
            $(this).append('<div class="stack_pointer" id="' + varDivID + '">&nbsp;</div>');

            assert(!connectionEndpointIDs.has(varDivID));
            var heapObjID = myViz.generateID('heap_object_' + getRefID(val));
            connectionEndpointIDs.set(varDivID, heapObjID);
            //console.log('STACK->HEAP', varDivID, heapObjID);

            // GARBAGE COLLECTION GOTCHA! we need to get rid of the old
            // connector in preparation for rendering a new one:
            myViz.jsPlumbInstance.detachAllConnections(varDivID);
          }

          //console.log('CHANGED', varname, prevValStringRepr, valStringRepr);
        }

        // SUPER HACK - set current value as a hidden string attribute
        $(this).attr('data-curvalue', valStringRepr);
      }

    });

  // EXIT
  globalsD3.exit()
    .remove();


  // for aesthetics, hide globals if there aren't any globals to display
  if (curEntry.ordered_globals.length == 0) {
    this.domRoot.find('#' + globalsID).hide();
  }
  else {
    this.domRoot.find('#' + globalsID).show();
  }


  // holy cow, the d3 code for stack rendering is ABSOLUTELY NUTS!

  var stackDiv = myViz.domRootD3.select('#stack');

  // VERY IMPORTANT for selectAll selector to be SUPER specific here!
  var stackFrameDiv = stackDiv.selectAll('div.stackFrame,div.zombieStackFrame')
    .data(curEntry.stack_to_render, function(frame) {
      // VERY VERY VERY IMPORTANT for properly handling closures and nested functions
      // (see the backend code for more details)
      return frame.unique_hash;
    });

  var sfdEnter = stackFrameDiv.enter()
    .append('div')
    .attr('class', function(d, i) {return d.is_zombie ? 'zombieStackFrame' : 'stackFrame';})
    .attr('id', function(d, i) {return d.is_zombie ? myViz.generateID("zombie_stack" + i)
                                                   : myViz.generateID("stack" + i);
    })
    //.each(function(frame, i) {console.log('NEW STACK FRAME', frame.unique_hash);})

  sfdEnter
    .append('div')
    .attr('class', 'stackFrameHeader')
    .html(function(frame, i) {

      // pretty-print lambdas and display other weird characters
      // (might contain '<' or '>' for weird names like <genexpr>)
      var funcName = htmlspecialchars(frame.func_name).replace('&lt;lambda&gt;', 'λ');

      var headerLabel = funcName + '()';

      // only display if you're someone's parent
      if (frame.is_parent) {
        headerLabel = 'f' + frame.frame_id + ': ' + headerLabel;
      }

      // optional (btw, this isn't a CSS id)
      if (frame.parent_frame_id_list.length > 0) {
        var parentFrameID = frame.parent_frame_id_list[0];
        headerLabel = headerLabel + ' [parent=f' + parentFrameID + ']';
      }

      return headerLabel;
    })

  sfdEnter
    .append('table')
    .attr('class', 'stackFrameVarTable');


  var stackVarTable = stackFrameDiv
    .order() // VERY IMPORTANT to put in the order corresponding to data elements
    .select('table').selectAll('tr')
    .data(function(frame) {
        // each list element contains a reference to the entire frame
        // object as well as the variable name
        // TODO: look into whether we can use d3 parent nodes to avoid
        // this hack ... http://bost.ocks.org/mike/nest/
        return frame.ordered_varnames.map(function(varname) {return {varname:varname, frame:frame};});
      },
      function(d) {return d.varname;} // use variable name as key
    );

  stackVarTable
    .enter()
    .append('tr')
    .on('mouseover', highlightAliasedConnectors)
    .on('mouseout',  unhighlightAllConnectors);
 

  var stackVarTableCells = stackVarTable
    .selectAll('td.stackFrameVar,td.stackFrameValue')
    .data(function(d, i) {return [d, d] /* map identical data down both columns */;})

  stackVarTableCells.enter()
    .append('td')
    .attr('class', function(d, i) {return (i == 0) ? 'stackFrameVar' : 'stackFrameValue';})

  stackVarTableCells
    .order() // VERY IMPORTANT to put in the order corresponding to data elements
    .each(function(d, i) {
      var varname = d.varname;
      var frame = d.frame;

      if (i == 0) {
        if (varname == '__return__')
          $(this).html('<span class="retval">Return<br/>value</span>');
        else
          $(this).html(varname);
      }
      else {
        var val = frame.encoded_locals[varname];

        // include type in repr to prevent conflating integer 5 with string "5"
        var valStringRepr = String(typeof val) + ':' + String(val);

        // SUPER HACK - retrieve previous value as a hidden attribute
        var prevValStringRepr = $(this).attr('data-curvalue');

        // IMPORTANT! only clear the div and render a new element if the
        // value has changed
        if (valStringRepr != prevValStringRepr) {
          // TODO: render a transition

          $(this).empty(); // crude but effective for now

          if (isPrimitiveType(val)) {
            renderPrimitiveObject(val, $(this));
          }
          else {
            // add a stub so that we can connect it with a connector later.
            // IE needs this div to be NON-EMPTY in order to properly
            // render jsPlumb endpoints, so that's why we add an "&nbsp;"!

            // make sure varname and frame.unique_hash don't contain any weird
            // characters that are illegal for CSS ID's ...
            var varDivID = myViz.generateID(varnameToCssID(frame.unique_hash + '__' + varname));

            $(this).append('<div class="stack_pointer" id="' + varDivID + '">&nbsp;</div>');

            assert(!connectionEndpointIDs.has(varDivID));
            var heapObjID = myViz.generateID('heap_object_' + getRefID(val));
            connectionEndpointIDs.set(varDivID, heapObjID);
            //console.log('STACK->HEAP', varDivID, heapObjID);

            // GARBAGE COLLECTION GOTCHA! we need to get rid of the old
            // connector in preparation for rendering a new one:
            myViz.jsPlumbInstance.detachAllConnections(varDivID);
          }

          //console.log('CHANGED', frame.unique_hash, varname, prevValStringRepr, valStringRepr);
        }

        // SUPER HACK - set current value as a hidden string attribute
        $(this).attr('data-curvalue', valStringRepr);
      }
    });


  stackVarTableCells.exit().remove();

  stackVarTable.exit().remove();

  stackFrameDiv.exit()
    //.each(function(frame, i) {console.log('DEL STACK FRAME', frame.unique_hash, i);})
    .remove();


  // crap, we need to repaint all of the existing connectors in case their endpoints have shifted
  // due to page elements shifting around :(
  myViz.jsPlumbInstance.repaintEverything();

  // finally add all the NEW connectors that have arisen in this call to renderDataStructures
  connectionEndpointIDs.forEach(function(varID, valueID) {
    myViz.jsPlumbInstance.connect({source: varID, target: valueID});
  });

  /*
  myViz.jsPlumbInstance.select().each(function(c) {
    console.log('CONN:', c.sourceId, c.targetId);
  });
  */
  //console.log('---', myViz.jsPlumbInstance.select().length, '---');


  function highlight_frame(frameID) {
    myViz.jsPlumbInstance.select().each(function(c) {
      // this is VERY VERY fragile code, since it assumes that going up
      // FOUR layers of parent() calls will get you from the source end
      // of the connector to the enclosing stack frame
      var stackFrameDiv = c.source.parent().parent().parent().parent();

      // if this connector starts in the selected stack frame ...
      if (stackFrameDiv.attr('id') == frameID) {
        // then HIGHLIGHT IT!
        c.setPaintStyle({lineWidth:1, strokeStyle: connectorBaseColor});
        c.endpoints[0].setPaintStyle({fillStyle: connectorBaseColor});
        //c.endpoints[1].setVisible(false, true, true); // JUST set right endpoint to be invisible

        $(c.canvas).css("z-index", 1000); // ... and move it to the VERY FRONT
      }
      // for heap->heap connectors
      else if (heapConnectionEndpointIDs.has(c.endpoints[0].elementId)) {
        // NOP since it's already the color and style we set by default
      }
      else {
        // else unhighlight it
        c.setPaintStyle({lineWidth:1, strokeStyle: connectorInactiveColor});
        c.endpoints[0].setPaintStyle({fillStyle: connectorInactiveColor});
        //c.endpoints[1].setVisible(false, true, true); // JUST set right endpoint to be invisible

        $(c.canvas).css("z-index", 0);
      }
    });


    // clear everything, then just activate this one ...
    myViz.domRoot.find(".stackFrame").removeClass("highlightedStackFrame");
    myViz.domRoot.find('#' + frameID).addClass("highlightedStackFrame");
  }


  // highlight the top-most non-zombie stack frame or, if not available, globals
  var frame_already_highlighted = false;
  $.each(curEntry.stack_to_render, function(i, e) {
    if (e.is_highlighted) {
      highlight_frame(myViz.generateID('stack' + i));
      frame_already_highlighted = true;
    }
  });

  if (!frame_already_highlighted) {
    highlight_frame(myViz.generateID('globals'));
  }

}



ExecutionVisualizer.prototype.redrawConnectors = function() {
  this.jsPlumbInstance.repaintEverything();
}


// Utilities


/* colors - see pytutor.css for more colors */

var highlightedLineColor = '#e4faeb';
var highlightedLineTopBorderColor = '#005583';

var visitedLineColor = highlightedLineTopBorderColor;

var terminatedLineColor = '#a2eebd';

var darkRed = '#d03939';

var connectorBaseColor = '#005583';
var connectorHighlightColor = darkRed;
var connectorInactiveColor = '#cccccc';

var errorColor = darkRed;

var breakpointColor = darkRed;
var hoverBreakpointColor = connectorBaseColor;


function assert(cond) {
  if (!cond) {
    alert("Assertion Failure (see console log for backtrace)");
    throw 'Assertion Failure';
  }
}

// taken from http://www.toao.net/32-my-htmlspecialchars-function-for-javascript
function htmlspecialchars(str) {
  if (typeof(str) == "string") {
    str = str.replace(/&/g, "&amp;"); /* must do &amp; first */

    // ignore these for now ...
    //str = str.replace(/"/g, "&quot;");
    //str = str.replace(/'/g, "&#039;");

    str = str.replace(/</g, "&lt;");
    str = str.replace(/>/g, "&gt;");

    // replace spaces:
    str = str.replace(/ /g, "&nbsp;");
  }
  return str;
}

String.prototype.rtrim = function() {
  return this.replace(/\s*$/g, "");
}


// make sure varname doesn't contain any weird
// characters that are illegal for CSS ID's ...
//
// I know for a fact that iterator tmp variables named '_[1]'
// are NOT legal names for CSS ID's.
// I also threw in '{', '}', '(', ')', '<', '>' as illegal characters.
//
// TODO: what other characters are illegal???
var lbRE = new RegExp('\\[|{|\\(|<', 'g');
var rbRE = new RegExp('\\]|}|\\)|>', 'g');
function varnameToCssID(varname) {
  return varname.replace(lbRE, 'LeftB_').replace(rbRE, '_RightB');
}


// compare two JSON-encoded compound objects for structural equivalence:
function structurallyEquivalent(obj1, obj2) {
  // punt if either isn't a compound type
  if (isPrimitiveType(obj1) || isPrimitiveType(obj2)) {
    return false;
  }

  // must be the same compound type
  if (obj1[0] != obj2[0]) {
    return false;
  }

  // must have the same number of elements or fields
  if (obj1.length != obj2.length) {
    return false;
  }

  // for a list or tuple, same size (e.g., a cons cell is a list/tuple of size 2)
  if (obj1[0] == 'LIST' || obj1[0] == 'TUPLE') {
    return true;
  }
  else {
    var startingInd = -1;

    if (obj1[0] == 'DICT') {
      startingInd = 2;
    }
    else if (obj1[0] == 'INSTANCE') {
      startingInd = 3;
    }
    else {
      return false;
    }

    var obj1fields = d3.map();

    // for a dict or object instance, same names of fields (ordering doesn't matter)
    for (var i = startingInd; i < obj1.length; i++) {
      obj1fields.set(obj1[i][0], 1); // use as a set
    }

    for (var i = startingInd; i < obj2.length; i++) {
      if (!obj1fields.has(obj2[i][0])) {
        return false;
      }
    }

    return true;
  }
}


function isPrimitiveType(obj) {
  var typ = typeof obj;
  return ((obj == null) || (typ != "object"));
}

function getRefID(obj) {
  assert(obj[0] == 'REF');
  return obj[1];
}

