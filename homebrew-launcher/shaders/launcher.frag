#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "launcher-state.glsl"
#define HB_READONLY
#include "hb.glsl"
#include "launcher-text.glsl"
#include "draw.glsl"
float catalogText(vec2 p,vec2 origin,uint index,bool description){
 ivec2 q=ivec2(floor(p-origin));uint base=524288u+index*32768u,meta=base+25600u;
 uint width=c.atlas[meta+(description?2u:0u)],height=c.atlas[meta+(description?3u:1u)];
 if(any(lessThan(p-origin,vec2(0)))||q.x>=int(width)||q.y>=int(height))return 0.0;
 uint pixel=uint(q.y+(description?64:0))*512u+uint(q.x),word=c.atlas[base+(pixel>>2u)];
 return float((word>>((pixel&3u)*8u))&255u)/255.0;
}
vec4 catalogIcon(vec2 p,vec2 center,uint index){
 ivec2 q=ivec2(floor((p-center+vec2(36))*96.0/72.0));
 if(any(lessThan(q,ivec2(0)))||any(greaterThanEqual(q,ivec2(96))))return vec4(0);
 return unpackUnorm4x8(c.atlas[524288u+index*32768u+16384u+uint(q.y*96+q.x)]);
}
float wave(float x,float t) {
    return 336.0+30.0*sin(x*.0027+t*.72)+14.0*sin(x*.0053-t*.91);
}
void main() {
    vec2 p=gl_FragCoord.xy;
    float t=c.motion.x;
    // Light/dark theme.  c.transition.z eases between the two states.  Blue
    // accents and the ocean stay fixed; paper, cards and ink swap ends of the
    // palette at the midpoint, under a short dip to black.  A straight
    // cross-fade would drag dark ink and white paper through the same grey at
    // once, so text would be unreadable halfway through.
    float dm=clamp(c.transition.z,0.0,1.0);
    float theme=step(.5,dm),dip=1.0-abs(dm*2.0-1.0);
    vec3 paper=mix(vec3(.975,.989,.996),vec3(.018,.024,.038),theme);
    vec3 panelT=mix(vec3(1.0),vec3(.078,.094,.125),theme);
    vec3 inkT=mix(INK,vec3(.97,.99,1.0),theme);
    vec3 subT=mix(vec3(.39,.57,.68),vec3(.80,.86,.93),theme);
    vec3 hintT=mix(vec3(.42,.58,.66),vec3(.72,.81,.89),theme);
    vec3 borderT=mix(vec3(.83,.90,.94),vec3(.30,.40,.50),theme);
    vec3 skelT=mix(vec3(.88,.93,.96),vec3(.24,.31,.40),theme);
    vec3 plusT=mix(vec3(.54,.75,.85),vec3(.85,.93,.98),theme);
    vec3 dotT=mix(vec3(.63,.76,.82),vec3(.60,.72,.82),theme);
    vec3 cursorT=mix(vec3(1.0),vec3(.06,.08,.12),theme);
    float crest=wave(p.x,t);
    vec3 col=paper;
    // Three translucent sheets roll behind the main crest at different speeds.
    float sea=1.0-smoothstep(crest-1.0,crest+1.0,p.y);
    vec3 water=mix(vec3(.02,.40,.77),vec3(.03,.72,.91),clamp(p.x/2300.0+p.y/1500.0,0.0,1.0));
    water+=.023*sin(p.x*.003-p.y*.004+t*.17);
    for(int layer=3;layer>0;layer--) {
        float depth=float(layer);
        float edge=crest+depth*11.0+7.0*sin(p.x*(.003+depth*.0004)-t*(.42+depth*.19)+depth);
        float sheet=1.0-smoothstep(edge-.9,edge+.9,p.y);
        col=mix(col,mix(vec3(.43,.84,.96),vec3(.76,.94,.99),depth/3.0),sheet*.65);
        col=mix(col,vec3(.72,.96,1),line(p.y-edge,.8)*.55);
    }
    col=mix(col,water,sea);
    // The wave contours continue to the very top edge, with moving crests.
    for(int i=0;i<20;i++) {
        float height=crest-float(i)*25.0+13.0*sin(p.x*.003+float(i)*.4+t*.76);
        float strand=line(p.y-height, i==0 ? 1.6 : .75);
        col=mix(col,vec3(.55,.92,1.0),strand*sea*(i==0?.65:.12));
    }
    // Broad underwater ribbons drift against the finer surface contours.
    for(int i=0;i<6;i++) {
        float height=crest-float(i)*67.0-25.0+22.0*sin(p.x*.0021-t*.53+float(i)*.8);
        float ribbon=exp(-pow((p.y-height)/14.0,2.0));
        col=mix(col,vec3(.40,.88,.98),ribbon*.055*sea);
    }
    // Pale echoes drift across the white lower half and meet the screen edges.
    for(int i=0;i<8;i++) {
        float height=930.0+float(i)*24.0+48.0*sin(p.x*.0028-t*.57+float(i)*.24);
        col=mix(col,vec3(.56,.84,.94),line(p.y-height,.65)*.28);
    }
    // Fast foreground bubbles and a softer rear layer have independent drift.
    for(int i=0;i<32;i++) {
        float seed=float(i);
        bool rear=i>=24;
        float speed=rear?30.0+mod(seed,4.0)*7.0:48.0+mod(seed,6.0)*11.0;
        vec2 center=vec2(50.0+mod(seed*179.0,1820.0)+(14.0+mod(seed,5.0)*5.0)*sin(t*(.6+mod(seed,3.0)*.13)+seed)+9.0*sin(t*1.7+seed*2.0),
                         (rear?1180.0:480.0)-mod(seed*97.0+t*speed,rear?1280.0:600.0));
        float radius=5.0+mod(seed*7.0,22.0);
        float distanceToCenter=length(p-center);
        float opacity=(rear?.40:sea)*(.18+.05*sin(t+seed));
        col=mix(col,mix(vec3(.48,.80,.92),vec3(.78,.96,1),sea),line(distanceToCenter-radius,.9)*opacity);
        col=mix(col,vec3(.81,.97,1),fill(distanceToCenter-radius)*opacity*.07);
    }
    col=mix(col,vec3(.81,.96,1.0),text(p,vec2(164,75),TEXT_PLATFORM));
    col=mix(col,vec3(1),text(p,vec2(158,145),TEXT_TITLE));
    col=mix(col,vec3(.85,.97,1),text(p,vec2(164,263),TEXT_SUBTITLE));
    // The refresh arrow stays still until a tap starts the mock refresh cycle.
    vec2 emblem=p-vec2(1660,179);
    col=mix(col,vec3(.70,.95,1),line(length(emblem)-65.0,1.2)*.60);
    float turn=c.refresh.y;
    vec2 arrow=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*emblem;
    float arc=line(length(arrow)-33.0,2.7)*smoothstep(-2.5,-2.42,atan(arrow.y,arrow.x));
    // An equilateral arrowhead follows the clockwise tangent at the end of the arc.
    vec2 tip=vec2(-33.0,0.0);
    vec2 local=arrow-tip;
    float head=fill(max(max(local.y-5.0,-local.y*.5+local.x*.866-5.0),-local.y*.5-local.x*.866-5.0));
    col=mix(col,vec3(1),max(arc,head)*.95);
    uint count=min(c.library.x,32u);
    if(count>0u) {
        col=mix(col,inkT,text(p,vec2(302,437),TEXT_LIBRARY));
        ivec4 countLabel=TEXT_APPS;
        col=mix(col,hintT,text(p,vec2(1540,443),countLabel));
    }
    uint page=(c.state.x/3u)*3u;
    for(int i=0;i<3;i++) {
        uint index=page+uint(i);if(index>=count) continue;
        bool installed=index<c.reserved.w;
        float y=551.0+float(i)*151.0;
        float selected=c.state.x==index?1.0:0.0;
        float pulse=.6+.4*sin(t*2.4);
        float d=box(p,vec2(960,y),vec2(660,62),18.0);
        float shadow=exp(-max(box(p,vec2(960,y+7.0),vec2(660,62),18.0),0.0)/12.0);
        col=mix(col,mix(vec3(.38,.62,.74),vec3(0),theme),shadow*.08);
        col=mix(col,panelT,fill(d));
        col=mix(col,mix(borderT,BLUE,selected),line(d,1.0+selected*.4));
        col=mix(col,BLUE,exp(-max(d,0.0)/8.0)*selected*.04*pulse);
        float tile=box(p,vec2(370,y),vec2(43,43),12.0);
        col=mix(col,mix(mix(vec3(.94,.97,.985),vec3(.88,.96,1),selected),mix(vec3(.10,.13,.18),vec3(.10,.34,.48),selected),theme),fill(tile));
        if(installed){
            vec4 icon=catalogIcon(p,vec2(370,y),index);col=mix(col,icon.rgb,icon.a);
            col=mix(col,inkT,catalogText(p,vec2(450,y-30),index,false));
            col=mix(col,subT,catalogText(p,vec2(452,y+18),index,true));
        }else{
            float plus=min(box(p,vec2(370,y),vec2(11,1),1.0),box(p,vec2(370,y),vec2(1,11),1.0));
            col=mix(col,plusT,fill(plus)*.7);
            col=mix(col,skelT,fill(box(p,vec2(574,y-12.0),vec2(124,5),5))*.7);
            col=mix(col,skelT,fill(box(p,vec2(530,y+13),vec2(80,3),3)));
        }
        // Three tiny dots give the otherwise blank rows a gentle end cap.
        for(int j=0;j<3;j++) col=mix(col,dotT,fill(length(p-vec2(1540+float(j)*9.0,y))-1.5)*.7);
        float marker=box(p,vec2(289,y),vec2(2,18),2.0);
        col=mix(col,BLUE,fill(marker)*selected);
    }
    if(count==0u) {
        // Empty library: a quiet SD-card/search icon, with no placeholder rows.
        vec2 center=vec2(960,625);
        col=mix(col,panelT,fill(length(p-center)-86.0));
        vec2 card=p-(center-vec2(7,5));
        float body=max(box(card,vec2(0),vec2(39,49),6.0),(card.x-card.y-66.0)*.7071);
        col=mix(col,panelT,fill(body));
        col=mix(col,vec3(.23,.60,.79),line(body,1.8));
        for(int i=0;i<4;i++) col=mix(col,vec3(.48,.75,.87),fill(box(card,vec2(-20+float(i)*11.0,-29),vec2(2.5,8),1.5)));
        col=mix(col,vec3(.70,.86,.93),line(box(card,vec2(0,17),vec2(21,12),3.0),1.0));
        vec2 lens=p-(center+vec2(30,31));
        col=mix(col,panelT,fill(length(lens)-20.0));
        col=mix(col,BLUE,line(length(lens)-16.0,2.0));
        vec2 handle=lens-vec2(19,19);
        vec2 diagonal=vec2(handle.x+handle.y,handle.y-handle.x)*.7071;
        col=mix(col,BLUE,fill(box(diagonal,vec2(0),vec2(10,2),2.0)));
        col=mix(col,inkT,text(p,vec2(960.0-float(TEXT_NOTITLES.z)*.5,751),TEXT_NOTITLES));
        col=mix(col,hintT,text(p,vec2(960.0-float(TEXT_EMPTYHINT.z)*.5,805),TEXT_EMPTYHINT));
    } else {
        col=mix(col,BLUE,line(length(p-vec2(1480,1017))-14.0,1.2));
        col=mix(col,BLUE,text(p,vec2(1474,1011),TEXT_BUTTON_A));
        col=mix(col,inkT,text(p,vec2(1505,1009),TEXT_SELECT));
    }
    col=mix(col,BLUE,line(length(p-vec2(1638,1017))-14.0,1.2));
    col=mix(col,BLUE,text(p,vec2(1633,1011),TEXT_BUTTON_B));
    col=mix(col,inkT,text(p,vec2(1663,1009),TEXT_BACK));
    // Appearance switch, tucked to the right of Back.  It reads as an on/off
    // toggle: a pill track with the sun on the light side, the moon on the dark
    // side, and a blue knob that slides between them.
    float knobX=mix(1764.0,1844.0,dm);
    float sw=box(p,vec2(1804,1017),vec2(86,20),20.0);
    col=mix(col,mix(vec3(.84,.90,.95),vec3(.14,.19,.26),theme),fill(sw));
    col=mix(col,mix(vec3(.56,.70,.80),vec3(.34,.44,.55),theme),line(sw,1.1));
    vec2 sun=vec2(1734,1017);
    float sunDisc=fill(length(p-sun)-5.2);
    float sunRays=0.0;
    for(int i=0;i<8;i++){
        float a=.3926991*float(i);
        vec2 rayDir=vec2(cos(a),sin(a));
        sunRays=max(sunRays,line(stroke(p,sun+rayDir*9.2,sun+rayDir*12.4),1.0));
    }
    vec2 moon=vec2(1874,1017);
    float moonDisc=fill(length(p-moon)-8.6)*(1.0-fill(length(p-(moon+vec2(4.3,2.6)))-7.0));
    col=mix(col,inkT,max(sunDisc,sunRays));
    col=mix(col,inkT,moonDisc);
    col=mix(col,vec3(0),fill(length(p-vec2(knobX+1.0,1019.0))-15.0)*.18);
    float knob=fill(length(p-vec2(knobX,1017))-15.0);
    col=mix(col,BLUE,knob);
    col=mix(col,vec3(1),line(length(p-vec2(knobX,1017))-15.0,1.2)*.55);
    // A opens a friendly empty-slot panel; B brings the waves back into focus.
    float modal=c.motion.z;
    if(modal>.001) {
        col=mix(col,vec3(.06,.23,.37),modal*.30);
        float d=box(p,vec2(960,540),vec2(390,154),24.0);
        col=mix(col,panelT,fill(d)*modal);
        col=mix(col,mix(vec3(.75,.90,.96),vec3(.42,.52,.62),theme),line(d,1.0)*modal);
        col=mix(col,inkT,text(p,vec2(795,461),TEXT_EMPTY)*modal);
        col=mix(col,subT,text(p,vec2(769,527),TEXT_DETAIL)*modal);
        col=mix(col,BLUE,text(p,vec2(878,611),TEXT_CLOSE)*modal);
    }
    if(c.game.x!=0u&&c.stats.w!=0u){
        vec2 q=p-c.flow.xy;
        float cursor=min(stroke(q,vec2(0),vec2(0,28)),min(stroke(q,vec2(0),vec2(22,20)),stroke(q,vec2(0,28),vec2(22,20))));
        col=mix(col,cursorT,fill(cursor-3.8));col=mix(col,inkT,fill(cursor-1.7));
    }
    col=mix(col,hintT,text(p,vec2(36,1024),TEXT_CREDIT));
    outColor=vec4(col*(1.0-c.transition.x)*(1.0-dip*.96),1);
}
