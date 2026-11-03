import type { RuneliteScript } from "./bankScripts";

/**
 * RuneLite's patched chat scripts, copied unchanged from runelite-client/src/main/scripts at
 * RuneLite 1.13.5 (338e90a092). BSD-2-Clause: see ./LICENSE.
 *
 * They add the chatbox callbacks: "chatFilterCheck" (Chat Filter), "chatMessageBuilding" (Chat
 * Timestamps) and the private-chat username colour ones. ChatTimestamp shows the timestamp the
 * builder passes it whenever it is non-empty; the history ops leave it empty while the game's
 * own chat timestamp setting is off, so without a plugin the chatbox reads as before.
 */
export const RUNELITE_CHAT_SCRIPTS: readonly RuneliteScript[] = [
    {
        id: 84,
        name: "ChatBuilder",
        hash: "F7B4EC765ACB19D9625CDCA567E0EA355452AA12212791FE75F97C879290B4E8",
        source: `.id                       84
.int_arg_count            1
.long_arg_count           0
.obj_arg_count            0
   get_varc_int           1112
   clientclock           
   if_icmpeq              LABEL4
   jump                   LABEL14
LABEL4:
   clientclock           
   iconst                 1
   add                   
   set_varc_int           65
   iconst                 664
   iconst                 0
   sconst                 "i"
   iconst                 10616832
   if_setontimer         
   return                
LABEL14:
   clientclock           
   set_varc_int           1112
   iconst                 10616891
   if_getwidth           
   istore                 1
   chat_playername       
   removetags            
   ostore                 0
   iconst                 0
   istore                 2
   get_varc_int           41
   iconst                 3
   if_icmpeq              LABEL28
   jump                   LABEL30
LABEL28:
   iconst                 1
   istore                 2
LABEL30:
   iconst                 0
   istore                 3
   iconst                 0
   istore                 4
   iconst                 0
   istore                 5
   sconst                 "<col=004f00>"
   ostore                 1
   sconst                 "<col=0000ff>"
   ostore                 2
   sconst                 "<col=0000ff>"
   ostore                 3
   sconst                 ""
   ostore                 4
   sconst                 ""
   ostore                 5
   sconst                 ""
   ostore                 6
   sconst                 ""
   ostore                 7
   sconst                 ""
   ostore                 8
   sconst                 ""
   ostore                 9
   sconst                 ""
   ostore                 10
   sconst                 ""
   ostore                 11
   sconst                 ""
   ostore                 12
   sconst                 ""
   ostore                 13
   sconst                 ""
   ostore                 14
   sconst                 ""
   ostore                 15
   sconst                 ""
   ostore                 16
   sconst                 ""
   ostore                 17
   invoke                 921
   iconst                 1
   if_icmpeq              LABEL74
   jump                   LABEL163
LABEL74:
   iconst                 16777215
   iconst                 1
   iconst                 1
   istore                 5
   istore                 4
   istore                 3
   sconst                 "<col=30ff30>"
   sconst                 "<col=9070ff>"
   sconst                 "<col=9070ff>"
   ostore                 3
   ostore                 2
   ostore                 1
   iconst                 2897
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 4
   iconst                 2899
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 5
   iconst                 2902
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 6
   iconst                 2909
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 8
   iconst                 2907
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 7
   iconst                 2911
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 9
   iconst                 2913
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 10
   iconst                 2976
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 11
   iconst                 3746
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 12
   iconst                 3748
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 13
   iconst                 3750
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 14
   iconst                 4733
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 15
   sconst                 "<col=ff8f3e>"
   ostore                 16
   sconst                 "<col=12ea77>"
   ostore                 17
   jump                   LABEL239
LABEL163:
   iconst                 2896
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 4
   iconst                 2898
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 5
   iconst                 2901
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 6
   iconst                 2906
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 7
   iconst                 2908
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 8
   iconst                 2910
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 9
   iconst                 2912
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 10
   iconst                 2975
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 11
   iconst                 3745
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 12
   iconst                 3747
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 13
   iconst                 3749
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 14
   iconst                 4732
   iconst                 1230
   struct_param          
   sconst                 "col"
   invoke                 3739
   ostore                 15
   sconst                 "<col=93370c>"
   ostore                 16
   sconst                 "<col=004a23>"
   ostore                 17
LABEL239:
   iload                  3
   sconst                 "col"
   invoke                 3739
   ostore                 18
   oload                  4
   oload                  5
   oload                  6
   oload                  18
   oload                  7
   oload                  8
   oload                  9
   oload                  10
   oload                  11
   oload                  12
   oload                  13
   oload                  14
   oload                  15
   iload                  5
   invoke                 4484
   ostore                 15
   ostore                 14
   ostore                 13
   ostore                 12
   ostore                 11
   ostore                 10
   ostore                 9
   ostore                 8
   ostore                 7
   ostore                 18
   ostore                 6
   ostore                 5
   ostore                 4
   iconst                 0
   istore                 6
   iconst                 0
   istore                 7
   iconst                 0
   istore                 8
   iconst                 105
   iconst                 73
   iconst                 579
   iload                  8
   enum                  
   istore                 9
   get_varc_int           41
   iconst                 0
   if_icmpeq              LABEL290
   get_varc_int           41
   iconst                 2
   if_icmpeq              LABEL290
   jump                   LABEL343
LABEL290:
   chat_getmessagefilter 
   string_length         
   iconst                 0
   if_icmpgt              LABEL295
   jump                   LABEL343
LABEL295:
   oload                  4
   sconst                 "Public chat filtering:</col> <lt>"
   chat_getmessagefilter 
   escape                
   lowercase             
   sconst                 "<gt>"
   join_string            4
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   iload                  9
   if_clearops           
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iload                  6
   iload                  7
   sub                   
   istore                 6
   iload                  8
   iconst                 1
   add                   
   istore                 8
   iconst                 105
   iconst                 73
   iconst                 579
   iload                  8
   enum                  
   istore                 9
LABEL343:
   iload                  0
   istore                 10
   iconst                 0
   istore                 11
   iconst                 -1
   istore                 12
   sconst                 ""
   ostore                 19
   sconst                 ""
   ostore                 20
   sconst                 ""
   ostore                 21
   sconst                 ""
   ostore                 22
   iconst                 -1
   istore                 13
   iconst                 0
   istore                 14
   iconst                 0
   istore                 15
   sconst                 ""
   ostore                 23
   iconst                 -1
   istore                 16
   iconst                 -1
   istore                 17
   iconst                 -1
   istore                 18
   iconst                 126
   istore                 19
   iconst                 126
   istore                 20
   iconst                 0
   activeclansettings_find_affined
   iconst                 1
   if_icmpeq              LABEL380
   jump                   LABEL400
LABEL380:
   iconst                 0
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL385
   jump                   LABEL400
LABEL385:
   oload                  0
   activeclanchannel_getuserslot
   istore                 17
   iload                  17
   iconst                 -1
   if_icmpne              LABEL392
   jump                   LABEL395
LABEL392:
   iload                  17
   activeclanchannel_getuserrank
   istore                 18
LABEL395:
   activeclanchannel_getrankkick
   iconst                 2956
   invoke                 4456
   istore                 20
   istore                 19
LABEL400:
   sconst                 ""
   ostore                 24
   iconst                 0
   istore                 21
   sconst                 ""
   ostore                 25
   iconst                 -1
   istore                 22
LABEL408:
   iload                  10
   iconst                 -1
   if_icmpne              LABEL412
   jump                   LABEL2359
LABEL412:
   iload                  9
   iconst                 -1
   if_icmpne              LABEL416
   jump                   LABEL2359
LABEL416:
   iload                  10
   chat_gethistoryex_byuid
   istore                 21
   ostore                 24                ; timestamp
   istore                 15
   ostore                 21
   ostore                 20
   ostore                 19
   istore                 12
   istore                 11
   iload                  11
   oload                  19
   iload                  15
   oload                  21
   invoke                 193
   iconst                 1
   if_icmpeq              CHAT_FILTER
   jump                   LABEL2355
CHAT_FILTER:
   oload                  21                ; Load the message
   iconst                 1                 ; Gets changed to 0 if message is blocked
   iload                  11                ; Load the messageType
   iload                  10                 ; Load the id of the messageNode
   sconst                 "chatFilterCheck"
   runelite_callback     
   pop_int               ; Pop the id of the messageNode
   pop_int               ; Pop the messageType
   iconst                 1                 ; 2nd half of conditional
   ostore                 21                ; Override the message with our filtered message
   if_icmpeq              LABEL434          ; Check if we are building this message
   jump                   LABEL2355          ; continue to next message, skipping this
LABEL434:
   iload                  11
   oload                  19
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   oload                  21
   iload                  12
   iload                  2
   oload                  0
   iload                  15
   invoke                 90
   iconst                 1
   if_icmpeq              LABEL449
   jump                   LABEL2355
LABEL449:
   iconst                 0 ; splitpmbox
   iload                  10 ; message uid
   oload                  20 ; message channel
   oload                  19 ; message name
   oload                  21 ; message
   oload                  24 ; message timestamp
   sconst                 "chatMessageBuilding"
   runelite_callback     
   pop_int                   ; pop uid
   pop_int                   ; splitpmbox
   ostore                 24 ; message timestamp
   ostore                 21 ; message
   ostore                 19 ; message name
   ostore                 20 ; message channel
   iload                  11
   switch                
      2: LABEL452
      1: LABEL452
      90: LABEL476
      91: LABEL476
      3: LABEL500
      7: LABEL500
      101: LABEL525
      5: LABEL546
      6: LABEL582
      103: LABEL607
      104: LABEL607
      110: LABEL607
      109: LABEL628
      9: LABEL649
      111: LABEL677
      112: LABEL702
      41: LABEL727
      44: LABEL940
      43: LABEL1100
      46: LABEL1324
      14: LABEL1378
      118: LABEL1407
      107: LABEL1432
      119: LABEL1471
      113: LABEL1510
      114: LABEL1531
      116: LABEL1585
      0: LABEL1639
      117: LABEL1676
   jump                   LABEL1697
LABEL452:
   oload                  24
   oload                  19
   sconst                 ":"
   join_string            2
   sconst                 "null"
   invoke                 4742
   oload                  4
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL476:
   oload                  24
   oload                  19
   sconst                 ":"
   join_string            2
   sconst                 "null"
   invoke                 4742
   oload                  6
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL500:
   oload                  24
   sconst                 "From "
   oload                  19
   sconst                 ":"
   join_string            3
   sconst                 "privChatUsername"
   runelite_callback     
   sconst                 "null"
   invoke                 4742
   oload                  5
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL525:
   oload                  24
   oload                  9
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL546:
   oload                  24
   oload                  5
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   get_varbit             1627
   iconst                 0
   if_icmpeq              LABEL570
   jump                   LABEL581
LABEL570:
   iload                  12
   iconst                 500
   add                   
   iconst                 1
   add                   
   set_varc_int           65
   iconst                 664
   iconst                 0
   sconst                 "i"
   iconst                 10616832
   if_setontimer         
LABEL581:
   jump                   LABEL1714
LABEL582:
   oload                  24
   sconst                 "To "
   oload                  19
   sconst                 ":"
   join_string            3
   sconst                 "privChatUsername"
   runelite_callback     
   sconst                 "null"
   invoke                 4742
   oload                  5
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL607:
   oload                  24
   oload                  10
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL628:
   oload                  24
   sconst                 "<col=1a31f2>"
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL649:
   oload                  24
   sconst                 "["
   oload                  3
   oload                  20
   sconst                 "</col>] "
   oload                  19
   sconst                 ":"
   join_string            6
   sconst                 "null"
   invoke                 4742
   oload                  7
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL677:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
   oload                  24
   sconst                 "<col=1a31f2>"
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL702:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
   oload                  24
   sconst                 "<col=1a31f2>"
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL727:
   iconst                 1
   activeclansettings_find_affined
   iconst                 1
   if_icmpeq              LABEL732
   jump                   LABEL778
LABEL732:
   iconst                 1
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL737
   jump                   LABEL778
LABEL737:
   oload                  21
   invoke                 5501
   iconst                 1
   if_icmpeq              LABEL742
   jump                   LABEL778
LABEL742:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  12
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
   jump                   LABEL939
LABEL778:
   iconst                 0
   activeclansettings_find_affined
   iconst                 1
   if_icmpeq              LABEL783
   jump                   LABEL908
LABEL783:
   iconst                 0
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL788
   jump                   LABEL908
LABEL788:
   oload                  19
   removetags            
   activeclansettings_getaffinedslot
   istore                 17
   iload                  17
   iconst                 -1
   if_icmpne              LABEL796
   jump                   LABEL872
LABEL796:
   iload                  17
   activeclansettings_getaffinedrank
   invoke                 4302
   istore                 16
   ostore                 23
   iload                  16
   iconst                 -1
   if_icmpne              LABEL805
   jump                   LABEL837
LABEL805:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iload                  16
   iconst                 13
   iconst                 13
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  8
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
   jump                   LABEL871
LABEL837:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   oload                  2
   oload                  23
   sconst                 "</col> "
   oload                  19
   sconst                 ":"
   join_string            5
   oload                  8
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL871:
   jump                   LABEL907
LABEL872:
   iconst                 -1
   invoke                 4302
   istore                 16
   ostore                 23
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iload                  16
   iconst                 13
   iconst                 13
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  8
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL907:
   jump                   LABEL939
LABEL908:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  8
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL939:
   jump                   LABEL1714
LABEL940:
   activeclansettings_find_listened
   iconst                 1
   if_icmpeq              LABEL944
   jump                   LABEL1068
LABEL944:
   activeclanchannel_find_listened
   iconst                 1
   if_icmpeq              LABEL948
   jump                   LABEL1068
LABEL948:
   oload                  19
   removetags            
   activeclansettings_getaffinedslot
   istore                 17
   iload                  17
   iconst                 -1
   if_icmpne              LABEL956
   jump                   LABEL1032
LABEL956:
   iload                  17
   activeclansettings_getaffinedrank
   invoke                 4302
   istore                 16
   ostore                 23
   iload                  16
   iconst                 -1
   if_icmpne              LABEL965
   jump                   LABEL997
LABEL965:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iload                  16
   iconst                 13
   iconst                 13
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  11
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
   jump                   LABEL1031
LABEL997:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   oload                  2
   oload                  23
   sconst                 "</col> "
   oload                  19
   sconst                 ":"
   join_string            5
   oload                  11
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL1031:
   jump                   LABEL1067
LABEL1032:
   iconst                 -1
   invoke                 4302
   istore                 16
   ostore                 23
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iload                  16
   iconst                 13
   iconst                 13
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  11
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL1067:
   jump                   LABEL1099
LABEL1068:
   oload                  24
   sconst                 "["
   oload                  2
   oload                  20
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   oload                  19
   sconst                 ":"
   join_string            2
   oload                  11
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL1099:
   jump                   LABEL1714
LABEL1100:
   oload                  21
   invoke                 5309
   iconst                 1
   if_icmpeq              LABEL1105
   jump                   LABEL1185
LABEL1105:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 19
   oload                  21
   string_length         
   iconst                 0
   if_icmpgt              LABEL1114
   jump                   LABEL1125
LABEL1114:
   oload                  21
   sconst                 "|"
   iconst                 0
   string_indexof_string 
   iconst                 -1
   if_icmpne              LABEL1121
   jump                   LABEL1125
LABEL1121:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
LABEL1125:
   oload                  21
   sconst                 "</col>"
   sconst                 "</col>"
   oload                  14
   append                
   invoke                 3302
   ostore                 21
   iconst                 1
   activeclansettings_find_affined
   iconst                 1
   if_icmpeq              LABEL1137
   jump                   LABEL1163
LABEL1137:
   oload                  24
   sconst                 "["
   oload                  2
   activeclansettings_getclanname
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   oload                  14
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1184
LABEL1163:
   oload                  24
   sconst                 ""
   sconst                 "null"
   invoke                 4742
   oload                  14
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
LABEL1184:
   jump                   LABEL1323
LABEL1185:
   oload                  21
   invoke                 6264
   iconst                 1
   if_icmpeq              LABEL1190
   jump                   LABEL1240
LABEL1190:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 19
   iconst                 2
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL1199
   jump                   LABEL1221
LABEL1199:
   oload                  24
   sconst                 "["
   oload                  2
   sconst                 "PvP Arena</col>]"
   join_string            3
   sconst                 "null"
   invoke                 4742
   oload                  21
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1239
LABEL1221:
   oload                  24
   sconst                 ""
   sconst                 "null"
   invoke                 4742
   oload                  21
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
LABEL1239:
   jump                   LABEL1323
LABEL1240:
   oload                  21
   sconst                 "</col>"
   sconst                 "</col>"
   oload                  13
   append                
   invoke                 3302
   ostore                 21
   oload                  21
   string_length         
   iconst                 0
   if_icmpgt              LABEL1252
   jump                   LABEL1263
LABEL1252:
   oload                  21
   sconst                 "|"
   iconst                 0
   string_indexof_string 
   iconst                 -1
   if_icmpne              LABEL1259
   jump                   LABEL1263
LABEL1259:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
LABEL1263:
   iconst                 0
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL1268
   jump                   LABEL1298
LABEL1268:
   oload                  24
   sconst                 "["
   oload                  2
   activeclanchannel_getclanname
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   sconst                 ""
   oload                  13
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
   jump                   LABEL1323
LABEL1298:
   oload                  24
   sconst                 ""
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   sconst                 ""
   oload                  13
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL1323:
   jump                   LABEL1714
LABEL1324:
   activeclanchannel_find_listened
   iconst                 1
   if_icmpeq              LABEL1328
   jump                   LABEL1355
LABEL1328:
   oload                  24
   sconst                 "["
   oload                  2
   activeclanchannel_getclanname
   sconst                 "</col>]"
   join_string            4
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   sconst                 ""
   oload                  21
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
   jump                   LABEL1377
LABEL1355:
   oload                  24
   sconst                 ""
   sconst                 "null"
   invoke                 4742
   iconst                 -1
   iconst                 0
   iconst                 0
   sconst                 ""
   oload                  21
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 4483
   istore                 7
LABEL1377:
   jump                   LABEL1714
LABEL1378:
   oload                  21
   invoke                 2066
   istore                 13
   ostore                 22
   ostore                 21
   oload                  24
   oload                  1
   sconst                 "Broadcast:</col>"
   join_string            2
   sconst                 "null"
   invoke                 4742
   oload                  18
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1714
LABEL1407:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 22
   oload                  22
   invoke                 3436
   istore                 13
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL1432:
   clientclock           
   iload                  12
   sub                   
   iconst                 500
   if_icmpgt              LABEL1438
   jump                   LABEL1453
LABEL1438:
   sconst                 ""
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1470
LABEL1453:
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
LABEL1470:
   jump                   LABEL1714
LABEL1471:
   clientclock           
   iload                  12
   sub                   
   iconst                 1500
   if_icmpgt              LABEL1477
   jump                   LABEL1492
LABEL1477:
   sconst                 ""
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1509
LABEL1492:
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
LABEL1509:
   jump                   LABEL1714
LABEL1510:
   oload                  24
   oload                  16
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL1531:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 19
   oload                  19
   string_length         
   iconst                 0
   if_icmpgt              LABEL1540
   jump                   LABEL1564
LABEL1540:
   oload                  24
   oload                  19
   sconst                 ":"
   join_string            2
   sconst                 "null"
   invoke                 4742
   oload                  17
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1584
LABEL1564:
   oload                  24
   oload                  17
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
LABEL1584:
   jump                   LABEL1714
LABEL1585:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 19
   oload                  19
   string_length         
   iconst                 0
   if_icmpgt              LABEL1594
   jump                   LABEL1618
LABEL1594:
   oload                  24
   oload                  19
   sconst                 ":"
   join_string            2
   sconst                 "null"
   invoke                 4742
   oload                  4
   oload                  21
   sconst                 "</col>"
   join_string            3
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 203
   istore                 7
   jump                   LABEL1638
LABEL1618:
   oload                  24
   oload                  4
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
LABEL1638:
   jump                   LABEL1714
LABEL1639:
   oload                  21
   string_length         
   iconst                 0
   if_icmpgt              LABEL1644
   jump                   LABEL1656
LABEL1644:
   oload                  21
   sconst                 "|"
   iconst                 0
   string_indexof_string 
   iconst                 -1
   if_icmpne              LABEL1651
   jump                   LABEL1656
LABEL1651:
   oload                  21
   invoke                 632
   ostore                 21
   ostore                 25
   jump                   LABEL1658
LABEL1656:
   sconst                 ""
   ostore                 25
LABEL1658:
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL1676:
   oload                  24
   oload                  15
   oload                  21
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
   jump                   LABEL1714
LABEL1697:
   oload                  24
   oload                  21
   sconst                 "null"
   invoke                 4742
   iload                  8
   iload                  9
   iconst                 10616891
   iload                  1
   iconst                 3
   iconst                 14
   iload                  6
   iconst                 0
   iconst                 103
   iload                  3
   iload                  4
   invoke                 199
   istore                 7
LABEL1714:
   iload                  9
   if_clearops           
   iload                  11
   switch                
      1: LABEL1719
      2: LABEL1719
      3: LABEL1719
      6: LABEL1719
      7: LABEL1719
      9: LABEL1719
      90: LABEL1719
      91: LABEL1719
      106: LABEL1719
      41: LABEL1719
      44: LABEL1719
      0: LABEL1836
      101: LABEL1941
      103: LABEL1993
      104: LABEL1993
      110: LABEL1993
      14: LABEL2036
      118: LABEL2094
      109: LABEL2146
      111: LABEL2189
      112: LABEL2232
      43: LABEL2275
   jump                   LABEL2329
LABEL1719:
   sconst                 "<col=ffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iload                  11
   iconst                 41
   if_icmpne              LABEL1744
   jump                   LABEL1753
LABEL1744:
   oload                  19
   invoke                 2759
   iconst                 1
   if_icmpeq              LABEL1749
   jump                   LABEL1753
LABEL1749:
   iconst                 10
   sconst                 "Crown Info"
   iload                  9
   if_setop              
LABEL1753:
   oload                  0
   oload                  19
   removetags            
   compare               
   iconst                 0
   if_icmpne              LABEL1760
   jump                   LABEL1835
LABEL1760:
   iload                  15
   iconst                 1
   if_icmpeq              LABEL1764
   jump                   LABEL1769
LABEL1764:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL1777
LABEL1769:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL1777:
   iconst                 8
   sconst                 "Report"
   iload                  9
   if_setop              
   iload                  11
   iconst                 9
   if_icmpeq              LABEL1785
   jump                   LABEL1798
LABEL1785:
   clan_getchatcount     
   iconst                 0
   if_icmpgt              LABEL1789
   jump                   LABEL1797
LABEL1789:
   clan_getchatrank      
   clan_getchatminkick   
   if_icmpge              LABEL1793
   jump                   LABEL1797
LABEL1793:
   iconst                 9
   sconst                 "Kick"
   iload                  9
   if_setop              
LABEL1797:
   jump                   LABEL1835
LABEL1798:
   iload                  11
   iconst                 41
   if_icmpeq              LABEL1802
   jump                   LABEL1835
LABEL1802:
   iload                  18
   iload                  19
   if_icmpge              LABEL1806
   jump                   LABEL1835
LABEL1806:
   iconst                 0
   activeclanchannel_find_affined
   iconst                 1
   if_icmpeq              LABEL1811
   jump                   LABEL1835
LABEL1811:
   oload                  19
   removetags            
   activeclanchannel_getuserslot
   istore                 17
   iload                  17
   iconst                 -1
   if_icmpeq              LABEL1823
   iload                  17
   activeclanchannel_getuserrank
   iconst                 -1
   if_icmple              LABEL1823
   jump                   LABEL1835
LABEL1823:
   iconst                 9
   sconst                 "Kick"
   iload                  9
   if_setop              
   iload                  18
   iload                  20
   if_icmpge              LABEL1831
   jump                   LABEL1835
LABEL1831:
   iconst                 10
   sconst                 "Ban"
   iload                  9
   if_setop              
LABEL1835:
   jump                   LABEL2341
LABEL1836:
   oload                  19
   string_length         
   iconst                 0
   if_icmpgt              LABEL1841
   jump                   LABEL1874
LABEL1841:
   oload                  0
   oload                  19
   removetags            
   compare               
   iconst                 0
   if_icmpne              LABEL1848
   jump                   LABEL1874
LABEL1848:
   iconst                 8
   sconst                 "Report"
   iload                  9
   if_setop              
   sconst                 "<col=ffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   jump                   LABEL1940
LABEL1874:
   oload                  25
   string_length         
   iconst                 0
   if_icmpne              LABEL1879
   jump                   LABEL1928
LABEL1879:
   oload                  25
   sconst                 "CA_ID:"
   iconst                 0
   string_indexof_string 
   istore                 22
   iload                  22
   iconst                 -1
   if_icmpne              LABEL1888
   jump                   LABEL1927
LABEL1888:
   oload                  25
   iload                  22
   sconst                 "CA_ID:"
   string_length         
   add                   
   oload                  25
   string_length         
   substring             
   ostore                 25
   oload                  25
   invoke                 3436
   istore                 22
   iconst                 6
   sconst                 "View"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Open"
   iload                  9
   if_setop              
   sconst                 "<col=ffffff>Task</col>"
   iload                  9
   if_setopbase          
   iconst                 7821
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   iload                  22
   sconst                 "isii"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL1927:
   jump                   LABEL1940
LABEL1928:
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL1940:
   jump                   LABEL2341
LABEL1941:
   sconst                 "<col=ffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   invoke                 5548
   iconst                 1
   if_icmpeq              LABEL1966
   jump                   LABEL1971
LABEL1966:
   iconst                 1
   sconst                 "Accept invitation"
   iload                  9
   if_setop              
   jump                   LABEL1975
LABEL1971:
   iconst                 1
   sconst                 "Accept trade"
   iload                  9
   if_setop              
LABEL1975:
   iload                  15
   iconst                 1
   if_icmpeq              LABEL1979
   jump                   LABEL1984
LABEL1979:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL1992
LABEL1984:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL1992:
   jump                   LABEL2341
LABEL1993:
   sconst                 "<col=ffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iconst                 2
   sconst                 "Accept challenge"
   iload                  9
   if_setop              
   iload                  15
   iconst                 1
   if_icmpeq              LABEL2022
   jump                   LABEL2027
LABEL2022:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL2035
LABEL2027:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL2035:
   jump                   LABEL2341
LABEL2036:
   oload                  22
   string_length         
   iconst                 0
   if_icmpgt              LABEL2041
   jump                   LABEL2070
LABEL2041:
   iload                  13
   iconst                 -1
   if_icmpne              LABEL2045
   jump                   LABEL2070
LABEL2045:
   iconst                 6
   sconst                 "Open"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Check"
   iload                  9
   if_setop              
   iconst                 2065
   iload                  9
   if_getlayer           
   iload                  8
   iconst                 3158271
   sconst                 "iii"
   iload                  9
   if_setonmouseover     
   iconst                 2065
   iload                  9
   if_getlayer           
   iload                  8
   iload                  3
   sconst                 "iii"
   iload                  9
   if_setonmouseleave    
   jump                   LABEL2078
LABEL2070:
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL2078:
   iconst                 9
   sconst                 "Clear history"
   iload                  9
   if_setop              
   sconst                 "<col=ff9040>Notification</col>"
   iload                  9
   if_setopbase          
   iconst                 2064
   iconst                 -2147483644
   iconst                 9
   oload                  22
   iload                  13
   sconst                 "iisi"
   iload                  9
   if_setonop            
   jump                   LABEL2341
LABEL2094:
   iconst                 105
   iconst                 73
   iconst                 5918
   iload                  13
   enum                  
   iconst                 -1
   if_icmpne              LABEL2102
   jump                   LABEL2123
LABEL2102:
   iconst                 6
   sconst                 "Open"
   iload                  9
   if_setop              
   iconst                 2065
   iload                  9
   if_getlayer           
   iload                  8
   iconst                 8355711
   sconst                 "iii"
   iload                  9
   if_setonmouseover     
   iconst                 2065
   iload                  9
   if_getlayer           
   iload                  8
   iload                  3
   sconst                 "iii"
   iload                  9
   if_setonmouseleave    
   jump                   LABEL2131
LABEL2123:
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL2131:
   iconst                 9
   sconst                 "Clear all"
   iload                  9
   if_setop              
   sconst                 "<col=ff9040>Skill guide</col>"
   iload                  9
   if_setopbase          
   iconst                 7780
   iconst                 -2147483644
   iconst                 9
   iload                  13
   sconst                 "iii"
   iload                  9
   if_setonop            
   jump                   LABEL2341
LABEL2146:
   sconst                 "<col=0xffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 2
   sconst                 "Form clan"
   iload                  9
   if_setop              
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iload                  15
   iconst                 1
   if_icmpeq              LABEL2175
   jump                   LABEL2180
LABEL2175:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL2188
LABEL2180:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL2188:
   jump                   LABEL2341
LABEL2189:
   sconst                 "<col=0xffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 2
   sconst                 "Form group"
   iload                  9
   if_setop              
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iload                  15
   iconst                 1
   if_icmpeq              LABEL2218
   jump                   LABEL2223
LABEL2218:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL2231
LABEL2223:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL2231:
   jump                   LABEL2341
LABEL2232:
   sconst                 "<col=0xffffff>"
   oload                  19
   sconst                 "</col>"
   join_string            3
   iload                  9
   if_setopbase          
   iconst                 2
   sconst                 "Group with"
   iload                  9
   if_setop              
   iconst                 86
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   sconst                 "isi"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iload                  15
   iconst                 1
   if_icmpeq              LABEL2261
   jump                   LABEL2266
LABEL2261:
   iconst                 6
   sconst                 "Message"
   iload                  9
   if_setop              
   jump                   LABEL2274
LABEL2266:
   iconst                 6
   sconst                 "Add friend"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Add ignore"
   iload                  9
   if_setop              
LABEL2274:
   jump                   LABEL2341
LABEL2275:
   oload                  25
   string_length         
   iconst                 0
   if_icmpne              LABEL2280
   jump                   LABEL2328
LABEL2280:
   oload                  25
   sconst                 "CA_ID:"
   iconst                 0
   string_indexof_string 
   istore                 22
   iload                  22
   iconst                 -1
   if_icmpne              LABEL2289
   jump                   LABEL2328
LABEL2289:
   oload                  25
   iload                  22
   sconst                 "CA_ID:"
   string_length         
   add                   
   oload                  25
   string_length         
   substring             
   ostore                 25
   oload                  25
   invoke                 3436
   istore                 22
   iconst                 6
   sconst                 "View"
   iload                  9
   if_setop              
   iconst                 7
   sconst                 "Open"
   iload                  9
   if_setop              
   sconst                 "<col=ffffff>Task</col>"
   iload                  9
   if_setopbase          
   iconst                 7821
   iconst                 -2147483644
   sconst                 "event_opbase"
   iload                  11
   iload                  22
   sconst                 "isii"
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL2328:
   jump                   LABEL2341
LABEL2329:
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
LABEL2341:
   iload                  6
   iload                  7
   sub                   
   istore                 6
   iload                  8
   iconst                 1
   add                   
   istore                 8
   iconst                 105
   iconst                 73
   iconst                 579
   iload                  8
   enum                  
   istore                 9
LABEL2355:
   iload                  10
   chat_getprevuid       
   istore                 10
   jump                   LABEL408
LABEL2359:
   iload                  8
   istore                 23
LABEL2361:
   iload                  9
   iconst                 -1
   if_icmpne              LABEL2365
   jump                   LABEL2448
LABEL2365:
   iload                  9
   if_clearops           
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseover     
   iconst                 -1
   sconst                 ""
   iload                  9
   if_setonmouseleave    
   iconst                 0
   iconst                 0
   iconst                 0
   iconst                 0
   iload                  9
   if_setsize            
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2393
   jump                   LABEL2397
LABEL2393:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL2397:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 1
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2407
   jump                   LABEL2411
LABEL2407:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL2411:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 2
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2421
   jump                   LABEL2425
LABEL2421:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL2425:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 3
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2435
   jump                   LABEL2437
LABEL2435:
   iconst                 1
   cc_sethide            
LABEL2437:
   iload                  8
   iconst                 1
   add                   
   istore                 8
   iconst                 105
   iconst                 73
   iconst                 579
   iload                  8
   enum                  
   istore                 9
   jump                   LABEL2361
LABEL2448:
   iload                  6
   iconst                 2
   sub                   
   istore                 6
   iconst                 0
   iload                  6
   sub                   
   istore                 6
   iconst                 10616891
   if_getheight          
   istore                 24
   iload                  6
   iload                  24
   if_icmpgt              LABEL2463
   jump                   LABEL2465
LABEL2463:
   iload                  6
   istore                 24
LABEL2465:
   iload                  23
   istore                 8
LABEL2467:
   iload                  8
   iconst                 0
   if_icmpgt              LABEL2471
   jump                   LABEL2554
LABEL2471:
   iload                  8
   iconst                 1
   sub                   
   istore                 8
   iconst                 105
   iconst                 73
   iconst                 579
   iload                  8
   enum                  
   istore                 9
   iload                  9
   if_gety               
   iload                  24
   add                   
   iconst                 2
   sub                   
   istore                 6
   iload                  9
   if_getx               
   iload                  6
   iconst                 0
   iconst                 0
   iload                  9
   if_setposition        
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2503
   jump                   LABEL2508
LABEL2503:
   cc_getx               
   iload                  6
   iconst                 0
   iconst                 0
   cc_setposition        
LABEL2508:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 1
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2518
   jump                   LABEL2523
LABEL2518:
   cc_getx               
   iload                  6
   iconst                 0
   iconst                 0
   cc_setposition        
LABEL2523:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 2
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2533
   jump                   LABEL2538
LABEL2533:
   cc_getx               
   iload                  6
   iconst                 0
   iconst                 0
   cc_setposition        
LABEL2538:
   iconst                 10616891
   iload                  8
   iconst                 4
   multiply              
   iconst                 3
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL2548
   jump                   LABEL2553
LABEL2548:
   cc_getx               
   iload                  6
   iconst                 0
   iconst                 0
   cc_setposition        
LABEL2553:
   jump                   LABEL2467
LABEL2554:
   iconst                 0
   iload                  24
   iconst                 10616891
   if_setscrollsize      
   iconst                 10617392
   iconst                 10616891
   get_varc_int           7
   iload                  24
   get_varc_int           8
   sub                   
   add                   
   invoke                 72
   iconst                 10616891
   if_getscrolly         
   iload                  24
   set_varc_int           8
   set_varc_int           7
   return                
`,
    },
    {
        id: 89,
        name: "ChatSplitBuilder",
        hash: "A92472A08CFFC09992D8C2F0F03E0BDD04FCF442BF412F2641138C52DF645184",
        source: `.id                       89
.int_arg_count            1
.long_arg_count           0
.obj_arg_count            0
   iconst                 0
   istore                 1
   iconst                 2
   istore                 2
   iconst                 103
   istore                 3
   iconst                 4
   istore                 4
   iconst                 23
   istore                 5
   invoke                 900
   istore                 6
   iconst                 103
   iconst                 105
   iconst                 1136
   iload                  6
   enum                  
   iconst                 0
   if_icmpgt              LABEL20
   jump                   LABEL79
LABEL20:
   iload                  6
   invoke                 9336
   iconst                 1
   if_icmpeq              LABEL25
   jump                   LABEL37
LABEL25:
   iconst                 0
   iconst                 102
   iconst                 103
   iconst                 105
   iconst                 1960
   iload                  6
   enum                  
   iconst                 30
   istore                 5
   istore                 1
   istore                 3
   istore                 2
LABEL37:
   iload                  6
   invoke                 9336
   iconst                 1
   if_icmpeq              LABEL42
   jump                   LABEL57
LABEL42:
   get_varc_int           1220
   iconst                 1
   if_icmpeq              LABEL46
   jump                   LABEL57
LABEL46:
   iconst                 4
   istore                 4
   invoke                 3179
   iconst                 1
   if_icmpeq              LABEL52
   jump                   LABEL56
LABEL52:
   iload                  4
   iconst                 30
   add                   
   istore                 4
LABEL56:
   jump                   LABEL79
LABEL57:
   get_varc_int           41
   iconst                 1337
   if_icmpeq              LABEL61
   jump                   LABEL70
LABEL61:
   invoke                 922
   iconst                 1
   if_icmpeq              LABEL65
   jump                   LABEL70
LABEL65:
   iload                  4
   iload                  5
   add                   
   istore                 4
   jump                   LABEL79
LABEL70:
   iload                  4
   iconst                 73
   iconst                 73
   iload                  6
   iconst                 10551392
   enum                  
   if_getheight          
   add                   
   istore                 4
LABEL79:
   iload                  4
   istore                 7
   iconst                 10682368
   if_getwidth           
   istore                 8
   iconst                 0
   istore                 9
   iconst                 105
   iconst                 73
   iconst                 580
   iload                  9
   enum                  
   istore                 10
   iconst                 0
   istore                 11
   sconst                 ""
   ostore                 0
   reboottimer           
   iconst                 0
   if_icmpgt              LABEL100
   jump                   LABEL177
LABEL100:
   reboottimer           
   iconst                 50
   div                   
   iconst                 60
   mod                   
   istore                 11
   iload                  11
   iconst                 10
   if_icmplt              LABEL110
   jump                   LABEL121
LABEL110:
   sconst                 "System update in: "
   reboottimer           
   iconst                 3000
   div                   
   tostring              
   sconst                 ":0"
   iload                  11
   tostring              
   join_string            4
   ostore                 0
   jump                   LABEL131
LABEL121:
   sconst                 "System update in: "
   reboottimer           
   iconst                 3000
   div                   
   tostring              
   sconst                 ":"
   iload                  11
   tostring              
   join_string            4
   ostore                 0
LABEL131:
   iload                  7
   oload                  0
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 16776960
   iconst                 1
   invoke                 199
   add                   
   istore                 7
   iload                  10
   if_clearops           
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouserepeat   
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouseleave    
   iconst                 0
   iconst                 0
   iconst                 0
   iconst                 0
   iload                  10
   if_setsize            
   iload                  9
   iconst                 1
   add                   
   istore                 9
   iconst                 105
   iconst                 73
   iconst                 580
   iload                  9
   enum                  
   istore                 10
LABEL177:
   iconst                 -1
   istore                 12
   iconst                 -1
   istore                 13
   sconst                 ""
   ostore                 1
   iconst                 0
   istore                 14
   sconst                 ""
   ostore                 2
   iconst                 0
   istore                 15
   sconst                 ""
   ostore                 3
   sconst                 ""
   ostore                 4
   iconst                 -1
   istore                 16
   iconst                 0
   istore                 17
   sconst                 "<col=00ffff>"
   ostore                 5
   sconst                 "<col=ffff00>"
   ostore                 6
   oload                  5
   oload                  6
   invoke                 4485
   ostore                 6
   ostore                 5
   get_varc_int           55
   get_varc_int           202
   if_icmpge              LABEL210
   jump                   LABEL339
LABEL210:
   get_varc_int           55
   clientclock           
   iconst                 3000
   sub                   
   if_icmpgt              LABEL216
   jump                   LABEL339
LABEL216:
   iconst                 14
   chat_gethistorylength 
   iconst                 0
   if_icmpgt              LABEL221
   jump                   LABEL339
LABEL221:
   iconst                 14
   iconst                 0
   chat_gethistoryex_bytypeandline
   istore                 15
   ostore                 2
   istore                 14
   ostore                 0
   ostore                 3
   ostore                 1
   istore                 13
   istore                 12
   iload                  12
   iconst                 -1
   if_icmpne              LABEL236
   jump                   LABEL339
LABEL236:
   oload                  0
   invoke                 2066
   istore                 16
   ostore                 4
   ostore                 0
   iload                  16
   iconst                 4
   if_icmpne              LABEL248
   reboottimer           
   iconst                 0
   if_icmple              LABEL248
   jump                   LABEL339
LABEL248:
   iload                  7
   oload                  2
   oload                  6
   oload                  0
   sconst                 "</col>"
   join_string            3
   sconst                 "null"
   invoke                 4742
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 16776960
   iconst                 1
   invoke                 199
   add                   
   istore                 7
   iload                  10
   if_clearops           
   oload                  4
   string_length         
   iconst                 0
   if_icmpgt              LABEL277
   jump                   LABEL306
LABEL277:
   iload                  16
   iconst                 -1
   if_icmpne              LABEL281
   jump                   LABEL306
LABEL281:
   iconst                 6
   sconst                 "Open"
   iload                  10
   if_setop              
   iconst                 7
   sconst                 "Check"
   iload                  10
   if_setop              
   iconst                 2065
   iload                  10
   if_getlayer           
   iload                  9
   iconst                 16777215
   sconst                 "iii"
   iload                  10
   if_setonmouserepeat   
   iconst                 2065
   iload                  10
   if_getlayer           
   iload                  9
   iconst                 16776960
   sconst                 "iii"
   iload                  10
   if_setonmouseleave    
   jump                   LABEL314
LABEL306:
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouserepeat   
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouseleave    
LABEL314:
   iconst                 10
   sconst                 "Clear history"
   iload                  10
   if_setop              
   sconst                 "<col=ff9040>Notification</col>"
   iload                  10
   if_setopbase          
   iconst                 2064
   iconst                 -2147483644
   iconst                 10
   oload                  4
   iload                  16
   sconst                 "iisi"
   iload                  10
   if_setonop            
   iload                  9
   iconst                 1
   add                   
   istore                 9
   iconst                 105
   iconst                 73
   iconst                 580
   iload                  9
   enum                  
   istore                 10
LABEL339:
   iload                  0
   istore                 12
   iconst                 0
   istore                 18
   invoke                 4487
   istore                 19
   get_varp               287
   iconst                 1
   if_icmpeq              LABEL349
   jump                   LABEL589
LABEL349:
   get_varc_int           41
   iconst                 1337
   if_icmpne              LABEL356
   get_varbit             4089
   iconst                 0
   if_icmpeq              LABEL356
   jump                   LABEL589
LABEL356:
   invoke                 7831
   iconst                 1
   if_icmpeq              LABEL360
   jump                   LABEL589
LABEL360:
   iload                  12
   iconst                 -1
   if_icmpne              LABEL364
   jump                   LABEL589
LABEL364:
   iload                  10
   iconst                 -1
   if_icmpne              LABEL368
   jump                   LABEL589
LABEL368:
   iload                  7
   iload                  4
   sub                   
   iconst                 57
   if_icmplt              LABEL374
   jump                   LABEL589
LABEL374:
   iload                  12
   chat_gethistoryex_byuid
   istore                 15
   ostore                 2                 ; timestamp
   istore                 14
   ostore                 0
   ostore                 3
   ostore                 1
   istore                 13
   istore                 18
   iload                  18
   oload                  1
   iload                  13
   iload                  14
   invoke                 91
   iconst                 1
   if_icmpeq              CHAT_FILTER       ; Jump to our new label instead
   jump                   LABEL585
CHAT_FILTER:
   oload                  0                 ; Load the message
   iconst                 1                 ; Gets changed to 0 if message is blocked
   iload                  18                ; Load the messageType
   iload                  12                ; Load the id of the messageNode
   sconst                 "chatFilterCheck"
   runelite_callback     
   pop_int               ; Pop the id of the messageNode
   pop_int               ; Pop the messageType
   iconst                 1                 ; 2nd half of conditional
   ostore                 0                 ; Override the message with our filtered message
   if_icmpeq              LABEL392          ; Check if we are building this message
   jump                   LABEL585
LABEL392:
   iconst                 1 ; splitpmbox
   iload                  12 ; message uid
   sconst                 "" ; message channel
   oload                  1 ; message name
   oload                  0 ; message
   oload                  2 ; message timestamp
   sconst                 "chatMessageBuilding"
   runelite_callback     
   pop_int                  ; uid
   pop_int                  ; splitpmbox
   ostore                 2 ; message timestamp
   ostore                 0 ; message
   ostore                 1 ; message name
   pop_object               ; message channel
   iload                  18
   switch                
      3: LABEL395
      7: LABEL395
      6: LABEL423
      5: LABEL451
   jump                   LABEL489
LABEL395:
   iload                  7
   oload                  2
   oload                  5
   sconst                 "splitPrivChatUsernameColor"
   runelite_callback     
   sconst                 "From "
   oload                  1
   sconst                 ":</col>"
   join_string            4
   oload                  5
   invoke                 4742
   oload                  5
   oload                  0
   sconst                 "</col>"
   join_string            3
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 65535
   iconst                 1
   invoke                 203
   add                   
   istore                 7
   jump                   LABEL508
LABEL423:
   iload                  7
   oload                  2
   oload                  5
   sconst                 "splitPrivChatUsernameColor"
   runelite_callback     
   sconst                 "To "
   oload                  1
   sconst                 ":</col>"
   join_string            4
   oload                  5
   invoke                 4742
   oload                  5
   oload                  0
   sconst                 "</col>"
   join_string            3
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 65535
   iconst                 1
   invoke                 203
   add                   
   istore                 7
   jump                   LABEL508
LABEL451:
   iload                  7
   oload                  2
   oload                  5
   oload                  0
   sconst                 "</col>"
   join_string            3
   oload                  5
   invoke                 4742
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 65535
   iconst                 1
   invoke                 199
   add                   
   istore                 7
   iload                  19
   iconst                 0
   if_icmpeq              LABEL477
   jump                   LABEL488
LABEL477:
   iload                  13
   iconst                 500
   add                   
   iconst                 1
   add                   
   set_varc_int           65
   iconst                 664
   iconst                 0
   sconst                 "i"
   iconst                 10616832
   if_setontimer         
LABEL488:
   jump                   LABEL508
LABEL489:
   iload                  7
   oload                  2
   oload                  0
   sconst                 "null"
   invoke                 4742
   iload                  9
   iload                  10
   iconst                 10682368
   iload                  8
   iload                  1
   iconst                 13
   iload                  7
   iload                  2
   iload                  3
   iconst                 65535
   iconst                 1
   invoke                 199
   add                   
   istore                 7
LABEL508:
   iload                  10
   if_clearops           
   iload                  18
   iconst                 3
   if_icmpeq              LABEL520
   iload                  18
   iconst                 6
   if_icmpeq              LABEL520
   iload                  18
   iconst                 7
   if_icmpeq              LABEL520
   jump                   LABEL563
LABEL520:
   iload                  14
   iconst                 1
   if_icmpeq              LABEL524
   jump                   LABEL529
LABEL524:
   iconst                 7
   sconst                 "Message"
   iload                  10
   if_setop              
   jump                   LABEL537
LABEL529:
   iconst                 7
   sconst                 "Add friend"
   iload                  10
   if_setop              
   iconst                 8
   sconst                 "Add ignore"
   iload                  10
   if_setop              
LABEL537:
   iconst                 9
   sconst                 "Report"
   iload                  10
   if_setop              
   oload                  1
   invoke                 2759
   iconst                 1
   if_icmpeq              LABEL546
   jump                   LABEL550
LABEL546:
   iconst                 10
   sconst                 "Crown Info"
   iload                  10
   if_setop              
LABEL550:
   sconst                 "<col=ffffff>"
   oload                  1
   sconst                 "</col>"
   join_string            3
   iload                  10
   if_setopbase          
   iconst                 88
   iconst                 -2147483644
   sconst                 "event_opbase"
   sconst                 "is"
   iload                  10
   if_setonop            
   jump                   LABEL567
LABEL563:
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonop            
LABEL567:
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouserepeat   
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouseleave    
   iload                  9
   iconst                 1
   add                   
   istore                 9
   iconst                 105
   iconst                 73
   iconst                 580
   iload                  9
   enum                  
   istore                 10
LABEL585:
   iload                  12
   chat_getprevuid       
   istore                 12
   jump                   LABEL360
LABEL589:
   iload                  10
   iconst                 -1
   if_icmpne              LABEL593
   jump                   LABEL676
LABEL593:
   iload                  10
   if_clearops           
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonop            
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouserepeat   
   iconst                 -1
   sconst                 ""
   iload                  10
   if_setonmouseleave    
   iconst                 0
   iconst                 0
   iconst                 0
   iconst                 0
   iload                  10
   if_setsize            
   iconst                 10682368
   iload                  9
   iconst                 4
   multiply              
   cc_find               
   iconst                 1
   if_icmpeq              LABEL621
   jump                   LABEL625
LABEL621:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL625:
   iconst                 10682368
   iload                  9
   iconst                 4
   multiply              
   iconst                 1
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL635
   jump                   LABEL639
LABEL635:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL639:
   iconst                 10682368
   iload                  9
   iconst                 4
   multiply              
   iconst                 2
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL649
   jump                   LABEL653
LABEL649:
   sconst                 ""
   cc_settext            
   iconst                 1
   cc_sethide            
LABEL653:
   iconst                 10682368
   iload                  9
   iconst                 4
   multiply              
   iconst                 3
   add                   
   cc_find               
   iconst                 1
   if_icmpeq              LABEL663
   jump                   LABEL665
LABEL663:
   iconst                 1
   cc_sethide            
LABEL665:
   iload                  9
   iconst                 1
   add                   
   istore                 9
   iconst                 105
   iconst                 73
   iconst                 580
   iload                  9
   enum                  
   istore                 10
   jump                   LABEL589
LABEL676:
   return                
`,
    },
    {
        id: 4742,
        name: "ChatTimestamp",
        hash: "B50E1BA11980BD6FD6FE3661A5CB7AF9E6AAD96027D629FADE9C020AF0F97CE8",
        source: `; used by TimestampPlugin via Chat(Split)Builder to display timestamps
; add a timestamp to a message
; string0 = timestamp
; string1 = message
; string2 = timestamp color
.id                       4742
.int_arg_count            0
.long_arg_count           0
.obj_arg_count            3
   jump                   ENABLED ; jump over ~on_enhanced_any = 0 | chat_gettimestamps = 0
   invoke                 100
   iconst                 0
   if_icmpeq              LABEL11
   5025                  
   iconst                 0
   if_icmpeq              LABEL11
ENABLED:
   oload                  0
   invoke                 5529
   iconst                 1
   if_icmpeq              LABEL11
   jump                   LABEL13
LABEL11:
   oload                  1
   return                
LABEL13:
   oload                  1
   invoke                 5530
   invoke                 5529
   iconst                 1
   if_icmpeq              LABEL19
   jump                   LABEL21
LABEL19:
   oload                  1
   return                
LABEL21:
   oload                  2
   invoke                 5529
   iconst                 0
   if_icmpeq              LABEL26
   jump                   LABEL31
LABEL26:
   oload                  2
   oload                  0
   sconst                 "</col>"
   join_string            3
   ostore                 0
LABEL31:
   oload                  0
   sconst                 " "
   oload                  1
   join_string            3
   return                
   sconst                 ""
   return                
`,
    },
];
