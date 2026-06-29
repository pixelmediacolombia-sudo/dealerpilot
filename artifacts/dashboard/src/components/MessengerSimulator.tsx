import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateMessageContext, getGetLeadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  chatText: z.string().min(1, "Message text is required"),
  buyerName: z.string().optional(),
  sourceUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export function MessengerSimulator() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMessage = useCreateMessageContext();
  const [lastReply, setLastReply] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      chatText: "",
      buyerName: "",
      sourceUrl: "",
    },
  });

  const onSubmit = (data: FormValues) => {
    setLastReply(null);
    createMessage.mutate(
      {
        data: {
          chatText: data.chatText,
          buyerName: data.buyerName || undefined,
          sourceUrl: data.sourceUrl || undefined,
        },
      },
      {
        onSuccess: (result) => {
          setLastReply(result.suggestedReply);
          queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
          form.reset({
            chatText: "",
            buyerName: data.buyerName,
            sourceUrl: data.sourceUrl,
          });
          toast({
            title: "Message simulated successfully",
            description: "A new lead has been created in the CRM.",
          });
        },
        onError: () => {
          toast({
            title: "Simulation failed",
            description: "There was an error creating the message context.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Card className="flex flex-col h-full border-t-4 border-t-blue-500 shadow-md">
      <CardHeader className="bg-card pb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-500/10 rounded-md">
            <MessageSquarePlus className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <CardTitle className="text-xl">Messenger Simulator</CardTitle>
            <CardDescription>Test the AI reply endpoint</CardDescription>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="chatText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Buyer Message <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="e.g. Is this still available? Would you take $500 less?" 
                      className="min-h-[100px] resize-none"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="buyerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Buyer Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sourceUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source URL (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://facebook.com/..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700" 
              disabled={createMessage.isPending}
            >
              {createMessage.isPending ? "Generating Reply..." : "Simulate Message"}
            </Button>
          </form>
        </Form>

        {lastReply && (
          <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 mb-2 text-primary font-semibold">
              <Bot className="w-4 h-4" />
              <span>AI Suggested Reply</span>
            </div>
            <p className="text-sm text-foreground/90">{lastReply}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
