import { useQueryClient } from "@tanstack/react-query";
import { useGetTestListing, getGetTestListingQueryKey, getTestListing } from "@workspace/api-client-react";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Car, Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function TestVehicleCard() {
  const queryClient = useQueryClient();
  const { data: listing, isLoading } = useGetTestListing();
  const [isSending, setIsSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [jsonResult, setJsonResult] = useState<string | null>(null);

  const handleSendToExtension = async () => {
    setIsSending(true);
    setSuccess(false);
    try {
      // In a real app, this might be a mutation, but the requirement is to fetch/refetch
      // the test listing via useGetTestListing and display the JSON.
      const data = await queryClient.fetchQuery({
        queryKey: getGetTestListingQueryKey(),
        queryFn: () => getTestListing()
      });
      setJsonResult(JSON.stringify(data, null, 2));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSending(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  return (
    <Card className="flex flex-col h-full overflow-hidden border-t-4 border-t-primary shadow-md">
      <CardHeader className="bg-card pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-md">
              <Car className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Test Vehicle Listing</CardTitle>
              <CardDescription>Alpha Motorsport</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="bg-muted text-muted-foreground font-mono">ID: TEST-001</Badge>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 pt-4">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="grid grid-cols-2 gap-4 mt-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ) : listing ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-2xl font-bold text-foreground">
                {listing.year} {listing.make} {listing.model}
              </h3>
              <p className="text-lg font-semibold text-primary mt-1">
                {formatCurrency(listing.price)}
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/50 p-3 rounded-md">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Down Payment</p>
                <p className="text-sm font-medium">{formatCurrency(listing.downPayment)}</p>
              </div>
              <div className="bg-muted/50 p-3 rounded-md">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Mileage</p>
                <p className="text-sm font-medium">{formatNumber(listing.mileage)} mi</p>
              </div>
            </div>
            
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Description</p>
              <p className="text-sm text-foreground/80 line-clamp-3">{listing.description}</p>
            </div>

            {jsonResult && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 flex items-center justify-between">
                  Payload Preview
                  {success && <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Sent</span>}
                </p>
                <div className="bg-slate-900 text-slate-50 p-3 rounded-md text-xs font-mono overflow-x-auto max-h-[150px] overflow-y-auto">
                  <pre>{jsonResult}</pre>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center p-6 text-muted-foreground">Failed to load test listing</div>
        )}
      </CardContent>
      
      <CardFooter className="bg-muted/20 border-t pt-4">
        <Button 
          className="w-full" 
          size="lg" 
          onClick={handleSendToExtension} 
          disabled={isSending || isLoading}
          data-testid="button-send-test-listing"
        >
          {isSending ? (
             <span className="flex items-center gap-2">Sending...</span>
          ) : success ? (
             <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Extension Updated</span>
          ) : (
             <span className="flex items-center gap-2"><Send className="w-4 h-4" /> Send Test Listing to Extension</span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
